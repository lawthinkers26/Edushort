# EduShorts

EduShorts is a short-form educational video platform with vertical, swipeable reels, like Instagram Reels or TikTok. It uses a **metered paywall**: every learner gets a number of free reels that an admin controls, and after that they need a Razorpay subscription.

```
┌──────────────────────┐      Firebase ID token       ┌──────────────────────────┐
│ mobile/ (Expo + RN)  │ ───────────────────────────▶ │ backend/ (Express + TS)  │
│  • Category chips    │ ◀─── 403 SUBSCRIPTION_REQUIRED│  • Firebase auth guard   │
│  • Reel swiper (HLS) │                              │  • Subscription guard    │──▶ Supabase Postgres
│  • Paywall + Razorpay│ ── signed HLS ──▶ Bunny CDN  │  • Atomic view RPC       │    (RLS locked, RPCs)
└──────────────────────┘                              │  • Razorpay webhooks     │◀── Razorpay
┌──────────────────────┐   TUS upload ──▶ Bunny Stream│  • Bunny Stream API      │──▶ Bunny Stream API
│ admin/ (React + Vite)│ ───────────────────────────▶ │  • Admin CRUD + config   │
└──────────────────────┘                              └──────────────────────────┘
```

| Folder | Stack | What it contains |
| --- | --- | --- |
| [`supabase/`](supabase/migrations/20260925000000_init_schema.sql) | PostgreSQL | Tables, triggers, atomic RPC functions, RLS lockdown |
| [`backend/`](backend) | Node 20+, Express 5, TypeScript, `@supabase/supabase-js`, `firebase-admin`, `razorpay`, zod, pino | REST API, paywall enforcement, webhooks, Bunny integration |
| [`mobile/`](mobile) | Expo SDK 57, React Native 0.86, TypeScript, NativeWind 4, React Navigation 7, `expo-video` | The learner app |
| [`admin/`](admin) | React 19, Vite, TypeScript, Tailwind CSS 4, `tus-js-client` | Upload workspace, reels library, paywall controller |

---

## Part 1: Database (Supabase)

Apply [`supabase/migrations/20260925000000_init_schema.sql`](supabase/migrations/20260925000000_init_schema.sql). You can use `supabase db push`, or paste it into the SQL editor.

| Table | Purpose |
| --- | --- |
| `profiles` | Keyed by **Firebase UID**. Holds `subscription_status`, `subscription_expires_at`, `free_reels_watched_count`, and the `liked_reels` / `saved_reels` arrays (`uuid[]`, GIN-indexed). |
| `reels` | Holds `bunny_video_id`, `bunny_library_id`, `title`, `description`, and `category` (a CHECK constraint allows only `History`, `Polity`, `Geography`, `Science`). Also stores `likes_count`, `comments_count`, `views_count`, and `is_published`. |
| `system_config` | A single-row table (`id = 1`, enforced by a CHECK constraint) that stores `free_reel_limit`. |
| `reel_views` | One row per (user, reel). Watching a reel again never uses up another free view. |
| `reel_comments` | Comments. Triggers keep `reels.comments_count` in step inside the same transaction. |
| `payment_webhook_events` | An idempotency ledger for Razorpay deliveries. |

The backend calls these RPC functions:

- **`increment_reel_view(uid, reel_id)`** locks the profile row (`FOR UPDATE`), reads `free_reel_limit`, and records the view. It increments `free_reels_watched_count` only when the user is under the limit. Because every call for the same user waits for that lock, parallel requests can never exceed the limit.
- **`set_reel_like` / `set_reel_save`** are idempotent. Each changes the profile array and the counter in one transaction.
- **`apply_subscription_event`** applies Razorpay state changes in event order, so a retried `charged` that arrives late can't reactivate a subscription that was already `cancelled`. While a subscription is active, its expiry date only moves forward.

**Security model:** RLS is enabled on every table and no policies are defined. The RPC functions are revoked from `anon` and `authenticated`, so the public Supabase key can't do anything. Only the backend, using the service-role key, can read or write data.

---

## Part 2: Backend (`backend/`)

```bash
cd backend
cp .env.example .env      # fill in Supabase, Firebase service account, Razorpay, Bunny
npm install
npm run dev               # http://localhost:4000
npm test                  # 21 unit/HTTP tests (no external services needed)
npm run build && npm start
npm run set-admin -- you@example.com   # grant the admin custom claim
```

### Middleware

- **`authenticate()`** ([`src/middleware/authenticate.ts`](backend/src/middleware/authenticate.ts)) checks the `Authorization: Bearer <Firebase ID token>` header with `firebase-admin` and sets `req.user = { uid, email, isAdmin, … }`. Admin routes also verify that the token hasn't been revoked.
- **`subscriptionGuard`** ([`src/middleware/subscriptionGuard.ts`](backend/src/middleware/subscriptionGuard.ts)) loads the profile and the current `free_reel_limit` (cached for 10 seconds). It returns **`403 { error: { code: "SUBSCRIPTION_REQUIRED", … } }`** when the user isn't subscribed and `free_reels_watched_count >= free_reel_limit`.
- **`requireAdmin`** requires the Firebase custom claim `admin: true`.

### API

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /api/categories` | – | Category list |
| `GET /api/me` / `PATCH /api/me` | user | Profile (created on first call) with subscription and free-view status |
| `GET /api/reels/feed?category=&cursor=&limit=` | user + **subscriptionGuard** | Keyset-paginated feed with signed Bunny HLS URLs. Free users never get more reels in one page than they have free views left. |
| `POST /api/reels/:id/view` | user | Atomic view increment through `.rpc('increment_reel_view')`. Returns `403 SUBSCRIPTION_REQUIRED` once the limit is reached. |
| `POST`/`DELETE /api/reels/:id/like`, `…/save` | user | Idempotent like and save |
| `GET`/`POST /api/reels/:id/comments` | user | Cursor-paginated comments and posting |
| `GET /api/reels/saved`, `GET /api/reels/:id` | user | Bookmarks and a single reel. Locked reels come back with `playback: null`. |
| `GET /api/payments/plan` | – | Plan price and period shown on the paywall |
| `POST /api/payments/subscriptions` | user | Creates a Razorpay subscription, or reuses an unpaid one, for Checkout |
| `POST /api/payments/verify` | user | Verifies the Checkout HMAC (`payment_id\|subscription_id`) and unlocks access immediately |
| `POST /api/payments/subscriptions/cancel` | user | Cancels at the end of the billing cycle |
| `POST /api/webhooks/razorpay` | signature | Checks `x-razorpay-signature` against the raw body with a timing-safe comparison, then handles `subscription.charged/activated/resumed` (grant) and `subscription.cancelled/halted/completed/expired/paused` (revoke) |
| `GET`/`PUT /api/admin/config` | admin | Reads or updates `system_config.free_reel_limit` |
| `GET /api/admin/stats` | admin | Dashboard counts |
| `POST /api/admin/uploads`, `GET /api/admin/uploads/:videoId` | admin | Creates a Bunny video and returns presigned TUS credentials; reports encoding status |
| `GET`/`POST`/`PATCH`/`DELETE /api/admin/reels[/:id]` | admin | Reel CRUD. Creating a reel checks that the video exists in Bunny. |

### Razorpay setup

1. Create a **Plan** under Dashboard → Subscriptions → Plans, then set `RAZORPAY_PLAN_ID`.
2. Add a **Webhook** pointing to `https://<api-host>/api/webhooks/razorpay` with a secret (`RAZORPAY_WEBHOOK_SECRET`). Enable these events: `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.halted`, `subscription.completed`, `subscription.paused`, `subscription.resumed`.
3. The Firebase UID is stored in each subscription's `notes.firebase_uid`, which is how webhooks find the right user.

### Bunny Stream setup

- `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, and `BUNNY_CDN_HOSTNAME` (the library's pull zone, `vz-xxxx.b-cdn.net`) are required.
- **Recommended:** enable *Token Authentication* on the pull zone and set `BUNNY_CDN_TOKEN_KEY`. Playback URLs are then signed with Bunny's SHA-256 **directory** tokens (`/bcdn_token=…&token_path=/{videoId}/…`). The token sits in the URL path, so every HLS rendition and segment URL inherits it. Each URL expires after `BUNNY_URL_TTL_SECONDS`, and the app refreshes a reel automatically when its URL expires.
- Optionally set `BUNNY_EMBED_TOKEN_KEY` to sign iframe embed URLs.
- Admin uploads go **directly from the browser to Bunny over TUS** using `SHA256(library_id + api_key + expires + video_id)` signatures, so the API key never reaches the browser.

---

## Part 3: Mobile app (`mobile/`)

```bash
cd mobile
cp .env.example .env      # API URL (use your LAN IP on a device) + Firebase web config
npm install
npx expo start            # Expo Go works: checkout runs in react-native-webview
```

| Piece | File |
| --- | --- |
| Category chips that reset and reload the feed immediately | [`src/components/CategoryBar.tsx`](mobile/src/components/CategoryBar.tsx), [`src/hooks/useFeed.ts`](mobile/src/hooks/useFeed.ts) |
| Full-screen vertical `FlatList` pager with `viewabilityConfig` (80% visible counts as centered) | [`src/components/ReelSwiper.tsx`](mobile/src/components/ReelSwiper.tsx) |
| `expo-video` HLS player: autoplays when centered, pauses and rewinds when scrolled away, preloads its neighbours, tap to pause, double-tap to like | [`src/components/ReelPlayer.tsx`](mobile/src/components/ReelPlayer.tsx) |
| Overlay: like (turns red), comment, share (native `Share`), save (turns gold) | [`src/components/ReelOverlay.tsx`](mobile/src/components/ReelOverlay.tsx) |
| Draggable comments bottom sheet | [`src/components/CommentsSheet.tsx`](mobile/src/components/CommentsSheet.tsx) |
| Paywall: any `403 SUBSCRIPTION_REQUIRED` fires an event that blocks the feed immediately | [`src/api/client.ts`](mobile/src/api/client.ts), [`src/context/PaywallContext.tsx`](mobile/src/context/PaywallContext.tsx), [`src/components/PaywallModal.tsx`](mobile/src/components/PaywallModal.tsx) |
| Razorpay Standard Checkout (`checkout.js` with `subscription_id`), with UPI app handoff | [`src/components/RazorpayCheckout.tsx`](mobile/src/components/RazorpayCheckout.tsx) |

**How the paywall works.** When the feed is fetched or a view is recorded, the API may answer `403 SUBSCRIPTION_REQUIRED`. `apiRequest` broadcasts that response, and the `PaywallProvider` blocks the feed and opens the premium modal. **"Unlock Unlimited Learning"** calls `POST /api/payments/subscriptions` and opens Razorpay Checkout. When checkout succeeds, the app calls `POST /api/payments/verify`, which unlocks access right away. The feed then reloads with unlimited access. The webhook stays the source of truth for renewals and cancellations.

---

## Part 4: Admin dashboard (`admin/`)

```bash
cd admin
cp .env.example .env      # API URL + Firebase web config
npm install
npm run dev               # http://localhost:5173 (add it to backend CORS_ORIGINS)
```

- **Upload Workspace:** drag and drop a video. It uploads to Bunny over TUS and can be paused, resumed, or cancelled. The Bunny video and library IDs fill in automatically, and encoding progress is shown while you wait. You can also link an existing Bunny GUID and verify it. The title, description, and category fields are validated in the browser using the same rules as the backend's zod schema, and field errors returned by the server (422) are shown on the matching inputs.
- **Reels Library:** search, filter by category, paginate, publish or unpublish, edit, and delete (optionally also deleting the video from Bunny).
- **Global Paywall Controller:** set `free_reel_limit` with a number input, a slider, or presets. Saving sends **`PUT /api/admin/config`**, and the page shows how many free users are currently blocked by the paywall.

Only accounts with the Firebase custom claim `admin: true` can sign in. Grant the claim with `npm run set-admin -- <email>` in `backend/`.
