import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/client';
import { recordView } from '../api/reels';
import { CategoryBar } from '../components/CategoryBar';
import { ReelSwiper } from '../components/ReelSwiper';
import type { CategoryFilter } from '../constants/categories';
import { colors } from '../constants/theme';
import { usePaywall } from '../context/PaywallContext';
import { useFeed } from '../hooks/useFeed';
import type { Reel } from '../types/api';

function FeedMessage({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center bg-ink-950 px-10">
      <Ionicons name={icon} size={48} color={colors.brandLight} />
      <Text className="mt-4 text-center text-xl font-bold text-white">{title}</Text>
      <Text className="mt-2 text-center text-sm leading-5 text-ink-300">{subtitle}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} className="mt-6 rounded-full bg-brand-600 px-6 py-3 active:opacity-80">
          <Text className="font-bold text-white">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function FeedScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { visible: paywallVisible, blocked, openPaywall, entitlementVersion } = usePaywall();
  const [category, setCategory] = useState<CategoryFilter>(null);

  const feed = useFeed(category, entitlementVersion);
  const { updateReel, setAccess, refreshReel, loadMore } = feed;
  const viewedIds = useRef(new Set<string>());

  const feedBlocked = blocked || feed.status === 'blocked';

  /** Record a view (burns a free view for non-subscribers) the first time each reel is centered. */
  const handleReelActivated = useCallback(
    (reel: Reel) => {
      if (viewedIds.current.has(reel.id) || reel.locked) return;
      viewedIds.current.add(reel.id);
      recordView(reel.id)
        .then((response) => {
          setAccess(response.access);
          updateReel(reel.id, (current) => ({
            ...current,
            viewsCount: current.viewsCount + (response.counted ? 1 : 0),
          }));
        })
        .catch((error: unknown) => {
          // 403 already opened the paywall via the API event bus; retry others later.
          if (!(error instanceof ApiError && error.isSubscriptionRequired)) viewedIds.current.delete(reel.id);
        });
    },
    [setAccess, updateReel],
  );

  const handlePlaybackExpired = useCallback((reel: Reel) => void refreshReel(reel.id), [refreshReel]);
  const handleLockedPress = useCallback(() => openPaywall(), [openPaywall]);

  const freeLeft = feed.access && !feed.access.subscribed ? feed.access.freeReelsRemaining : null;

  let body: React.ReactNode;
  if (feedBlocked) {
    body = (
      <FeedMessage
        icon="lock-closed"
        title="You've reached your free limit"
        subtitle="Subscribe to EduShorts Premium for unlimited History, Polity, Geography and Science reels."
        actionLabel="Unlock Unlimited Learning"
        onAction={() => openPaywall()}
      />
    );
  } else if (feed.status === 'loading') {
    body = (
      <View className="flex-1 items-center justify-center bg-ink-950">
        <ActivityIndicator size="large" color={colors.brandLight} />
      </View>
    );
  } else if (feed.status === 'error' && feed.items.length === 0) {
    body = (
      <FeedMessage
        icon="cloud-offline-outline"
        title="Couldn't load reels"
        subtitle={feed.error ?? 'Please check your connection.'}
        actionLabel="Try again"
        onAction={feed.retry}
      />
    );
  } else if (feed.items.length === 0) {
    body = (
      <FeedMessage
        icon="film-outline"
        title="No reels here yet"
        subtitle="New lessons are added every day. Try another category!"
        actionLabel="Refresh"
        onAction={feed.retry}
      />
    );
  } else {
    body = (
      <ReelSwiper
        reels={feed.items}
        playbackEnabled={isFocused && !paywallVisible && !feedBlocked}
        updateReel={updateReel}
        onReelActivated={handleReelActivated}
        onLockedPress={handleLockedPress}
        onPlaybackExpired={handlePlaybackExpired}
        onEndReached={feed.hasMore ? loadMore : undefined}
        refreshing={feed.refreshing}
        onRefresh={feed.refresh}
        resetKey={category ?? 'all'}
        ListFooterComponent={
          feed.loadingMore ? (
            <View className="items-center py-6">
              <ActivityIndicator color="#fff" />
            </View>
          ) : null
        }
      />
    );
  }

  return (
    <View className="flex-1 bg-black">
      <StatusBar style="light" />
      {body}

      {/* Floating header: category chips + free-reel meter */}
      <View pointerEvents="box-none" className="absolute left-0 right-0 top-0" style={{ paddingTop: insets.top }}>
        <CategoryBar selected={category} onSelect={setCategory} />
        {freeLeft !== null && !feedBlocked ? (
          <Pressable
            onPress={() => openPaywall()}
            className="ml-4 mt-1 flex-row items-center self-start rounded-full bg-black/45 px-3 py-1.5"
            accessibilityRole="button"
          >
            <Ionicons name="flash" size={12} color={colors.save} />
            <Text className="ml-1 text-xs font-semibold text-white">
              {freeLeft === 1 ? '1 free reel left' : `${freeLeft} free reels left`}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
