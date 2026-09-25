-- =============================================================================
-- EduShorts — initial schema
--
-- Access model: every table has Row Level Security enabled and NO policies,
-- so the public `anon` / `authenticated` PostgREST roles can read nothing.
-- The Express backend talks to Supabase with the service-role key (which
-- bypasses RLS) after verifying the caller's Firebase ID token. All RPC
-- functions are likewise revoked from the public roles.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at fresh
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles — one row per Firebase Auth user (keyed by Firebase UID)
-- -----------------------------------------------------------------------------
create table public.profiles (
  firebase_uid              text primary key
                            check (char_length(firebase_uid) between 1 and 128),
  email                     text,
  display_name              text check (display_name is null or char_length(display_name) <= 80),

  -- Subscription state (driven by Razorpay webhooks)
  subscription_status       boolean     not null default false,
  subscription_expires_at   timestamptz,
  razorpay_subscription_id  text unique,
  razorpay_subscription_state text,             -- raw Razorpay status: active, halted, cancelled, ...
  subscription_event_at     timestamptz,        -- created_at of the last applied webhook event (ordering guard)

  -- Metered paywall
  free_reels_watched_count  integer     not null default 0
                            check (free_reels_watched_count >= 0),

  -- Engagement (denormalised arrays, maintained atomically by RPCs below)
  liked_reels               uuid[]      not null default '{}',
  saved_reels               uuid[]      not null default '{}',

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index profiles_liked_reels_gin on public.profiles using gin (liked_reels);
create index profiles_saved_reels_gin on public.profiles using gin (saved_reels);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- reels — short educational videos hosted on Bunny Stream
-- -----------------------------------------------------------------------------
create table public.reels (
  id                uuid primary key default gen_random_uuid(),
  bunny_video_id    text not null unique
                    check (bunny_video_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  bunny_library_id  text not null check (bunny_library_id ~ '^[0-9]+$'),
  title             text not null check (char_length(title) between 3 and 120),
  description       text not null default '' check (char_length(description) <= 2000),
  category          text not null
                    constraint reels_category_check
                    check (category in ('History', 'Polity', 'Geography', 'Science')),
  likes_count       integer not null default 0 check (likes_count >= 0),
  comments_count    integer not null default 0 check (comments_count >= 0),
  views_count       bigint  not null default 0 check (views_count >= 0),
  duration_seconds  integer check (duration_seconds is null or duration_seconds >= 0),
  is_published      boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Keyset-pagination indexes for the feed (newest first, optionally per category)
create index reels_feed_idx
  on public.reels (created_at desc, id desc)
  where is_published;
create index reels_category_feed_idx
  on public.reels (category, created_at desc, id desc)
  where is_published;

create trigger reels_set_updated_at
  before update on public.reels
  for each row execute function public.set_updated_at();

-- When a reel is deleted, scrub it from every profile's liked/saved arrays.
create or replace function public.scrub_deleted_reel()
returns trigger
language plpgsql
as $$
begin
  update public.profiles
     set liked_reels = array_remove(liked_reels, old.id),
         saved_reels = array_remove(saved_reels, old.id)
   where liked_reels @> array[old.id]
      or saved_reels @> array[old.id];
  return old;
end;
$$;

create trigger reels_scrub_on_delete
  after delete on public.reels
  for each row execute function public.scrub_deleted_reel();

-- -----------------------------------------------------------------------------
-- system_config — single-row, admin-controlled configuration
-- -----------------------------------------------------------------------------
create table public.system_config (
  id               smallint primary key default 1 check (id = 1),  -- enforces a single row
  free_reel_limit  integer not null default 5
                   check (free_reel_limit between 0 and 10000),
  updated_at       timestamptz not null default now(),
  updated_by       text
);

create trigger system_config_set_updated_at
  before update on public.system_config
  for each row execute function public.set_updated_at();

insert into public.system_config (id, free_reel_limit)
values (1, 5)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- reel_views — one row per (user, reel); a re-watch never burns a free view
-- -----------------------------------------------------------------------------
create table public.reel_views (
  user_id          text not null references public.profiles (firebase_uid) on delete cascade,
  reel_id          uuid not null references public.reels (id) on delete cascade,
  first_viewed_at  timestamptz not null default now(),
  primary key (user_id, reel_id)
);

create index reel_views_reel_idx on public.reel_views (reel_id);

-- -----------------------------------------------------------------------------
-- reel_comments
-- -----------------------------------------------------------------------------
create table public.reel_comments (
  id          uuid primary key default gen_random_uuid(),
  reel_id     uuid not null references public.reels (id) on delete cascade,
  user_id     text not null references public.profiles (firebase_uid) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index reel_comments_reel_created_idx
  on public.reel_comments (reel_id, created_at desc, id desc);

-- comments_count is maintained in the same transaction as the insert/delete.
create or replace function public.sync_reel_comments_count()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.reels
       set comments_count = comments_count + 1
     where id = new.reel_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.reels
       set comments_count = greatest(comments_count - 1, 0)
     where id = old.reel_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger reel_comments_count_ins
  after insert on public.reel_comments
  for each row execute function public.sync_reel_comments_count();

create trigger reel_comments_count_del
  after delete on public.reel_comments
  for each row execute function public.sync_reel_comments_count();

-- -----------------------------------------------------------------------------
-- payment_webhook_events — idempotency ledger for Razorpay webhooks
-- -----------------------------------------------------------------------------
create table public.payment_webhook_events (
  event_id     text primary key,
  event_type   text not null,
  firebase_uid text,
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);

-- =============================================================================
-- RPC functions (called by the backend through supabase.rpc)
-- =============================================================================

-- Is a profile's subscription currently active? NULL expiry = no expiry (e.g. a
-- manually granted lifetime plan).
create or replace function public.is_subscription_active(
  p_status boolean,
  p_expires_at timestamptz
)
returns boolean
language sql
stable
as $$
  select coalesce(p_status, false)
     and (p_expires_at is null or p_expires_at > now());
$$;

-- -----------------------------------------------------------------------------
-- increment_reel_view
-- Atomically records a view and, for free users, burns one free view.
-- The profile row is locked FOR UPDATE, so concurrent calls from the same user
-- are serialised: the limit can never be overshot by parallel requests.
-- -----------------------------------------------------------------------------
create or replace function public.increment_reel_view(
  p_firebase_uid text,
  p_reel_id uuid
)
returns table (
  status        text,      -- 'OK' | 'LIMIT_REACHED'
  watched_count integer,
  reel_limit    integer,
  subscribed    boolean,
  counted       boolean    -- true when this call created a new view row
)
language plpgsql
as $$
declare
  v_profile   public.profiles%rowtype;
  v_limit     integer;
  v_active    boolean;
  v_inserted  integer;
  v_count     integer;
begin
  select * into v_profile
    from public.profiles p
   where p.firebase_uid = p_firebase_uid
     for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.reels r where r.id = p_reel_id and r.is_published) then
    raise exception 'REEL_NOT_FOUND' using errcode = 'P0002';
  end if;

  select c.free_reel_limit into v_limit from public.system_config c where c.id = 1;
  v_limit  := coalesce(v_limit, 0);
  v_active := public.is_subscription_active(v_profile.subscription_status, v_profile.subscription_expires_at);
  v_count  := v_profile.free_reels_watched_count;

  -- Subscribers: record analytics only; the free counter is untouched.
  if v_active then
    insert into public.reel_views (user_id, reel_id)
    values (p_firebase_uid, p_reel_id)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;

    if v_inserted > 0 then
      update public.reels r set views_count = r.views_count + 1 where r.id = p_reel_id;
    end if;

    return query select 'OK'::text, v_count, v_limit, true, v_inserted > 0;
    return;
  end if;

  -- Free user re-watching a reel they already unlocked: allowed, not counted.
  if exists (
    select 1 from public.reel_views v
     where v.user_id = p_firebase_uid and v.reel_id = p_reel_id
  ) then
    return query select 'OK'::text, v_count, v_limit, false, false;
    return;
  end if;

  if v_count >= v_limit then
    return query select 'LIMIT_REACHED'::text, v_count, v_limit, false, false;
    return;
  end if;

  insert into public.reel_views (user_id, reel_id) values (p_firebase_uid, p_reel_id);

  update public.profiles p
     set free_reels_watched_count = p.free_reels_watched_count + 1
   where p.firebase_uid = p_firebase_uid
  returning p.free_reels_watched_count into v_count;

  update public.reels r set views_count = r.views_count + 1 where r.id = p_reel_id;

  return query select 'OK'::text, v_count, v_limit, false, true;
end;
$$;

-- -----------------------------------------------------------------------------
-- set_reel_like — idempotent like/unlike; array + counter change in one txn
-- -----------------------------------------------------------------------------
create or replace function public.set_reel_like(
  p_firebase_uid text,
  p_reel_id uuid,
  p_liked boolean
)
returns table (is_liked boolean, total_likes integer)
language plpgsql
as $$
declare
  v_already boolean;
  v_total   integer;
begin
  select p_reel_id = any(p.liked_reels) into v_already
    from public.profiles p
   where p.firebase_uid = p_firebase_uid
     for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select r.likes_count into v_total
    from public.reels r
   where r.id = p_reel_id
     for update;

  if not found then
    raise exception 'REEL_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_liked and not v_already then
    update public.profiles p
       set liked_reels = array_append(p.liked_reels, p_reel_id)
     where p.firebase_uid = p_firebase_uid;
    update public.reels r
       set likes_count = r.likes_count + 1
     where r.id = p_reel_id
    returning r.likes_count into v_total;
  elsif not p_liked and v_already then
    update public.profiles p
       set liked_reels = array_remove(p.liked_reels, p_reel_id)
     where p.firebase_uid = p_firebase_uid;
    update public.reels r
       set likes_count = greatest(r.likes_count - 1, 0)
     where r.id = p_reel_id
    returning r.likes_count into v_total;
  end if;

  return query select p_liked, v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- set_reel_save — idempotent bookmark/unbookmark
-- -----------------------------------------------------------------------------
create or replace function public.set_reel_save(
  p_firebase_uid text,
  p_reel_id uuid,
  p_saved boolean
)
returns boolean
language plpgsql
as $$
declare
  v_already boolean;
begin
  if not exists (select 1 from public.reels r where r.id = p_reel_id) then
    raise exception 'REEL_NOT_FOUND' using errcode = 'P0002';
  end if;

  select p_reel_id = any(p.saved_reels) into v_already
    from public.profiles p
   where p.firebase_uid = p_firebase_uid
     for update;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_saved and not v_already then
    update public.profiles p
       set saved_reels = array_append(p.saved_reels, p_reel_id)
     where p.firebase_uid = p_firebase_uid;
  elsif not p_saved and v_already then
    update public.profiles p
       set saved_reels = array_remove(p.saved_reels, p_reel_id)
     where p.firebase_uid = p_firebase_uid;
  end if;

  return p_saved;
end;
$$;

-- -----------------------------------------------------------------------------
-- apply_subscription_event
-- Applies a Razorpay subscription state change. Events are ordered by their
-- Razorpay created_at, so a late-delivered retry can never overwrite a newer
-- state (e.g. a delayed `charged` re-activating a `cancelled` subscription).
-- Expiry only ever moves forward while active. p_event_at = NULL is used by the
-- checkout-verification path, which applies unconditionally without moving the
-- ordering watermark.
-- Returns true when the event changed the profile.
-- -----------------------------------------------------------------------------
create or replace function public.apply_subscription_event(
  p_firebase_uid     text,
  p_subscription_id  text,
  p_active           boolean,
  p_expires_at       timestamptz,
  p_razorpay_state   text,
  p_event_at         timestamptz
)
returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update public.profiles p
     set subscription_status         = p_active,
         subscription_expires_at     = case
                                         when p_active
                                           then greatest(p.subscription_expires_at, p_expires_at)
                                         else p_expires_at
                                       end,
         razorpay_subscription_id    = p_subscription_id,
         razorpay_subscription_state = p_razorpay_state,
         subscription_event_at       = coalesce(p_event_at, p.subscription_event_at)
   where p.firebase_uid = p_firebase_uid
     and (
           p_event_at is null                -- checkout verification: no event ordering
        or p.subscription_event_at is null
        or p.subscription_event_at <= p_event_at
     );

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- =============================================================================
-- Lock everything down: backend (service_role) only
-- =============================================================================
alter table public.profiles               enable row level security;
alter table public.reels                  enable row level security;
alter table public.system_config          enable row level security;
alter table public.reel_views             enable row level security;
alter table public.reel_comments          enable row level security;
alter table public.payment_webhook_events enable row level security;

revoke execute on function public.increment_reel_view(text, uuid)                       from public, anon, authenticated;
revoke execute on function public.set_reel_like(text, uuid, boolean)                     from public, anon, authenticated;
revoke execute on function public.set_reel_save(text, uuid, boolean)                     from public, anon, authenticated;
revoke execute on function public.apply_subscription_event(text, text, boolean, timestamptz, text, timestamptz)
                                                                                         from public, anon, authenticated;

grant execute on function public.increment_reel_view(text, uuid)                        to service_role;
grant execute on function public.set_reel_like(text, uuid, boolean)                      to service_role;
grant execute on function public.set_reel_save(text, uuid, boolean)                      to service_role;
grant execute on function public.apply_subscription_event(text, text, boolean, timestamptz, text, timestamptz)
                                                                                         to service_role;
