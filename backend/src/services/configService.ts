import { supabase } from '../lib/supabase';
import type { SystemConfigRow } from '../types/database';
import { fromDbError } from '../utils/httpError';

/**
 * system_config is read on every feed request, so it is cached in-process for a
 * few seconds. Updates made through this service invalidate the cache
 * immediately; other instances converge within CACHE_TTL_MS.
 */
const CACHE_TTL_MS = 10_000;

let cached: { value: SystemConfigRow; expiresAt: number } | null = null;

export async function getSystemConfig(): Promise<SystemConfigRow> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const { data, error } = await supabase.from('system_config').select('*').eq('id', 1).single();
  if (error) throw fromDbError(error, 'Loading system configuration');

  cached = { value: data, expiresAt: now + CACHE_TTL_MS };
  return data;
}

export async function updateFreeReelLimit(freeReelLimit: number, updatedBy: string): Promise<SystemConfigRow> {
  const { data, error } = await supabase
    .from('system_config')
    .upsert({ id: 1, free_reel_limit: freeReelLimit, updated_by: updatedBy }, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) throw fromDbError(error, 'Updating system configuration');

  cached = { value: data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

/** Test helper. */
export function clearConfigCache(): void {
  cached = null;
}
