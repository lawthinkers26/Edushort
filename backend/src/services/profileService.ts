import { supabase } from '../lib/supabase';
import type { AuthUser } from '../types/auth';
import type { ProfileRow } from '../types/database';
import { fromDbError, HttpError } from '../utils/httpError';
import { evaluateAccess, serializeAccess } from './accessPolicy';

export async function findProfile(uid: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('firebase_uid', uid).maybeSingle();
  if (error) throw fromDbError(error, 'Loading profile');
  return data;
}

/**
 * Returns the caller's profile, creating it on first contact. The insert uses
 * ON CONFLICT DO NOTHING so two concurrent first requests cannot collide.
 */
export async function getOrCreateProfile(user: AuthUser): Promise<ProfileRow> {
  const existing = await findProfile(user.uid);
  if (existing) return existing;

  const { error } = await supabase.from('profiles').upsert(
    {
      firebase_uid: user.uid,
      email: user.email,
      display_name: user.name ? user.name.slice(0, 80) : null,
    },
    { onConflict: 'firebase_uid', ignoreDuplicates: true },
  );
  if (error) throw fromDbError(error, 'Creating profile');

  const created = await findProfile(user.uid);
  if (!created) throw new HttpError(500, 'INTERNAL_ERROR', 'Profile could not be created');
  return created;
}

export async function findProfileBySubscriptionId(subscriptionId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('razorpay_subscription_id', subscriptionId)
    .maybeSingle();
  if (error) throw fromDbError(error, 'Looking up subscription owner');
  return data;
}

export async function updateDisplayName(uid: string, displayName: string): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('firebase_uid', uid)
    .select('*')
    .single();
  if (error) throw fromDbError(error, 'Updating profile');
  return data;
}

export function toProfileDto(profile: ProfileRow, freeReelLimit: number) {
  const access = evaluateAccess(profile, freeReelLimit);
  return {
    uid: profile.firebase_uid,
    email: profile.email,
    displayName: profile.display_name,
    subscription: {
      active: access.subscribed,
      status: profile.subscription_status,
      expiresAt: profile.subscription_expires_at,
      razorpayState: profile.razorpay_subscription_state,
    },
    access: serializeAccess(access),
    likedCount: profile.liked_reels.length,
    savedCount: profile.saved_reels.length,
    createdAt: profile.created_at,
  };
}

export type ProfileDto = ReturnType<typeof toProfileDto>;
