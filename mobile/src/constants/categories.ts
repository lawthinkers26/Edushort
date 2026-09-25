export const REEL_CATEGORIES = ['History', 'Polity', 'Geography', 'Science'] as const;
export type ReelCategory = (typeof REEL_CATEGORIES)[number];

/** `null` = the unfiltered "For You" feed. */
export type CategoryFilter = ReelCategory | null;

export interface CategoryChip {
  key: string;
  label: string;
  value: CategoryFilter;
  icon: string;
}

export const CATEGORY_CHIPS: readonly CategoryChip[] = [
  { key: 'all', label: 'For You', value: null, icon: '✨' },
  { key: 'history', label: 'History', value: 'History', icon: '🏛️' },
  { key: 'polity', label: 'Polity', value: 'Polity', icon: '⚖️' },
  { key: 'geography', label: 'Geography', value: 'Geography', icon: '🌏' },
  { key: 'science', label: 'Science', value: 'Science', icon: '🔬' },
];
