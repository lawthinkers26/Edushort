import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireUser } from '../middleware/authenticate';
import { getSystemConfig } from '../services/configService';
import { getOrCreateProfile, toProfileDto, updateDisplayName } from '../services/profileService';
import { validate } from '../utils/validate';

const UpdateProfileBody = z.object({
  displayName: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(2, 'Name must be at least 2 characters').max(80, 'Name must be at most 80 characters')),
});

/** GET /api/me — creates the profile on first sign-in. */
export async function getMe(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const [profile, config] = await Promise.all([getOrCreateProfile(user), getSystemConfig()]);
  res.json({ profile: toProfileDto(profile, config.free_reel_limit) });
}

/** PATCH /api/me */
export async function patchMe(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { displayName } = validate(UpdateProfileBody, req.body);

  await getOrCreateProfile(user);
  const [profile, config] = await Promise.all([updateDisplayName(user.uid, displayName), getSystemConfig()]);
  res.json({ profile: toProfileDto(profile, config.free_reel_limit) });
}
