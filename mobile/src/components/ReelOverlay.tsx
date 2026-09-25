import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors } from '../constants/theme';
import type { Reel } from '../types/api';

interface ReelOverlayProps {
  reel: Reel;
  bottomInset: number;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

interface ActionButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}

function ActionButton({ icon, color = colors.text, label, accessibilityLabel, onPress }: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="items-center active:scale-90"
    >
      <View className="h-12 w-12 items-center justify-center rounded-full bg-black/30">
        <Ionicons name={icon} size={30} color={color} />
      </View>
      <Text className="mt-1 text-xs font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

/**
 * Absolute-positioned interaction layer: right-hand action rail (like,
 * comment, share, save) and bottom-left metadata over a legibility gradient.
 */
function ReelOverlayComponent({ reel, bottomInset, onLike, onComment, onShare, onSave }: ReelOverlayProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.85)']}
        locations={[0, 0.45, 1]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' }}
      />

      {/* Action rail */}
      <View pointerEvents="box-none" className="absolute right-3 items-center gap-5" style={{ bottom: bottomInset + 24 }}>
        <ActionButton
          icon={reel.isLiked ? 'heart' : 'heart-outline'}
          color={reel.isLiked ? colors.like : colors.text}
          label={formatCount(reel.likesCount)}
          accessibilityLabel={reel.isLiked ? 'Unlike' : 'Like'}
          onPress={onLike}
        />
        <ActionButton
          icon="chatbubble-ellipses-outline"
          label={formatCount(reel.commentsCount)}
          accessibilityLabel="Open comments"
          onPress={onComment}
        />
        <ActionButton icon="paper-plane-outline" label="Share" accessibilityLabel="Share reel" onPress={onShare} />
        <ActionButton
          icon={reel.isSaved ? 'bookmark' : 'bookmark-outline'}
          color={reel.isSaved ? colors.save : colors.text}
          label={reel.isSaved ? 'Saved' : 'Save'}
          accessibilityLabel={reel.isSaved ? 'Remove from saved' : 'Save reel'}
          onPress={onSave}
        />
      </View>

      {/* Metadata */}
      <View pointerEvents="box-none" className="absolute left-4 right-20" style={{ bottom: bottomInset + 20 }}>
        <View className="mb-2 self-start rounded-full bg-brand-600/90 px-3 py-1">
          <Text className="text-xs font-bold uppercase tracking-wider text-white">{reel.category}</Text>
        </View>
        <Text className="text-lg font-bold leading-6 text-white" numberOfLines={2}>
          {reel.title}
        </Text>
        {reel.description ? (
          <Pressable onPress={() => setExpanded((value) => !value)} accessibilityRole="button" hitSlop={4}>
            <Text className="mt-1 text-sm leading-5 text-white/85" numberOfLines={expanded ? 8 : 2}>
              {reel.description}
            </Text>
            {!expanded && reel.description.length > 90 ? (
              <Text className="mt-0.5 text-sm font-semibold text-white/70">more</Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export const ReelOverlay = memo(ReelOverlayComponent);
