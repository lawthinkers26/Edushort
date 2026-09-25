import type { Profile } from '../types/api';
import { apiRequest } from './client';

export async function fetchProfile(): Promise<Profile> {
  const response = await apiRequest<{ profile: Profile }>('/api/me');
  return response.profile;
}

export async function updateProfile(displayName: string): Promise<Profile> {
  const response = await apiRequest<{ profile: Profile }>('/api/me', {
    method: 'PATCH',
    body: { displayName },
  });
  return response.profile;
}
