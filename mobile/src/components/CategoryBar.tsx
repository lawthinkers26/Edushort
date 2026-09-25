import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { CATEGORY_CHIPS, type CategoryFilter } from '../constants/categories';

interface CategoryBarProps {
  selected: CategoryFilter;
  onSelect: (category: CategoryFilter) => void;
}

/**
 * Horizontally scrolling chip selector floating over the feed. Selecting a chip
 * immediately swaps the feed to that category.
 */
function CategoryBarComponent({ selected, onSelect }: CategoryBarProps) {
  const scrollRef = useRef<ScrollView>(null);
  const chipOffsets = useRef<Record<string, number>>({});

  const selectedKey = CATEGORY_CHIPS.find((chip) => chip.value === selected)?.key ?? 'all';

  // Keep the active chip in view.
  useEffect(() => {
    const x = chipOffsets.current[selectedKey];
    if (x !== undefined) scrollRef.current?.scrollTo({ x: Math.max(x - 24, 0), animated: true });
  }, [selectedKey]);

  const handlePress = useCallback(
    (value: CategoryFilter) => {
      if (value === selected) return;
      void Haptics.selectionAsync().catch(() => undefined);
      onSelect(value);
    },
    [onSelect, selected],
  );

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-4 py-2"
      accessibilityRole="tablist"
    >
      {CATEGORY_CHIPS.map((chip) => {
        const active = chip.key === selectedKey;
        return (
          <View
            key={chip.key}
            onLayout={(event) => {
              chipOffsets.current[chip.key] = event.nativeEvent.layout.x;
            }}
          >
            <Pressable
              onPress={() => handlePress(chip.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${chip.label} reels`}
              hitSlop={6}
              className={`flex-row items-center rounded-full border px-4 py-2 ${
                active ? 'border-white bg-white' : 'border-white/25 bg-black/35'
              }`}
            >
              <Text className="mr-1.5 text-sm">{chip.icon}</Text>
              <Text className={`text-sm font-semibold ${active ? 'text-ink-950' : 'text-white'}`}>{chip.label}</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

export const CategoryBar = memo(CategoryBarComponent);
