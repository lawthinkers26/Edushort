import { REEL_CATEGORIES, isReelCategory, type ReelCategory, type ReelInput } from './types';

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LIBRARY_ID_RE = /^\d+$/;
export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB

export interface ReelFormValues {
  title: string;
  description: string;
  category: ReelCategory | '';
  bunnyVideoId: string;
  bunnyLibraryId: string;
  isPublished: boolean;
}

export type ReelFormErrors = Partial<Record<keyof ReelFormValues | 'file', string>>;

/** Mirrors the backend's zod schema so admins get instant feedback. */
export function validateReelForm(values: ReelFormValues): ReelFormErrors {
  const errors: ReelFormErrors = {};
  const title = values.title.trim();

  if (title.length < TITLE_MIN) errors.title = `Title must be at least ${TITLE_MIN} characters.`;
  else if (title.length > TITLE_MAX) errors.title = `Title must be at most ${TITLE_MAX} characters.`;

  if (values.description.trim().length > DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${DESCRIPTION_MAX} characters.`;
  }

  if (!values.category || !isReelCategory(values.category)) {
    errors.category = `Choose a category: ${REEL_CATEGORIES.join(', ')}.`;
  }

  if (!GUID_RE.test(values.bunnyVideoId.trim())) {
    errors.bunnyVideoId = 'Bunny video ID must be a GUID (e.g. 0f1e2d3c-…).';
  }

  if (!LIBRARY_ID_RE.test(values.bunnyLibraryId.trim())) {
    errors.bunnyLibraryId = 'Bunny library ID must be numeric.';
  }

  return errors;
}

export function toReelInput(values: ReelFormValues): ReelInput {
  if (!values.category) throw new Error('Category is required');
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    category: values.category,
    bunnyVideoId: values.bunnyVideoId.trim(),
    bunnyLibraryId: values.bunnyLibraryId.trim(),
    isPublished: values.isPublished,
  };
}

export function validateVideoFile(file: File): string | null {
  if (!file.type.startsWith('video/')) return 'Please choose a video file (MP4, MOV, WebM…).';
  if (file.size > MAX_UPLOAD_BYTES) return 'Video is larger than 4 GB.';
  if (file.size === 0) return 'This file is empty.';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
