import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  FlatList,
  RefreshControl,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { useAppActive } from '../hooks/useAppActive';
import type { ReelUpdater } from '../hooks/useFeed';
import { useReelActions } from '../hooks/useReelActions';
import type { Reel } from '../types/api';
import { CommentsSheet } from './CommentsSheet';
import { ReelPlayer } from './ReelPlayer';

interface ReelSwiperProps {
  reels: Reel[];
  /** False when the screen is unfocused or covered (paywall) — pauses playback. */
  playbackEnabled: boolean;
  updateReel: (id: string, updater: ReelUpdater) => void;
  /** Called once a reel has been centered (used to record views). */
  onReelActivated?: (reel: Reel) => void;
  onLockedPress: (reel: Reel) => void;
  onPlaybackExpired: (reel: Reel) => void;
  onEndReached?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Changing this scrolls back to the first reel (e.g. new category). */
  resetKey?: string;
  initialIndex?: number;
  bottomInset?: number;
  ListFooterComponent?: ReactElement | null;
}

const VIEWABILITY_CONFIG = {
  // A reel counts as "centered" once 80% of it is on screen.
  itemVisiblePercentThreshold: 80,
  minimumViewTime: 0,
};

/**
 * Full-screen vertical pager. Tracks the centered item via
 * `onViewableItemsChanged`, plays only that reel and preloads its neighbours.
 */
export function ReelSwiper({
  reels,
  playbackEnabled,
  updateReel,
  onReelActivated,
  onLockedPress,
  onPlaybackExpired,
  onEndReached,
  refreshing = false,
  onRefresh,
  resetKey,
  initialIndex = 0,
  bottomInset = 0,
  ListFooterComponent,
}: ReelSwiperProps) {
  const appActive = useAppActive();
  const listRef = useRef<FlatList<Reel>>(null);
  const [height, setHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [commentsFor, setCommentsFor] = useState<Reel | null>(null);
  const { toggleLike, toggleSave, share, incrementComments } = useReelActions(updateReel);

  // onViewableItemsChanged must be referentially stable for FlatList.
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<Reel>[] }) => {
    const centered = viewableItems.find((token) => token.isViewable && token.index !== null);
    if (centered?.index !== null && centered?.index !== undefined) setActiveIndex(centered.index);
  }).current;

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    setHeight((current) => (current === next ? current : next));
  }, []);

  // New category → jump to the top.
  useEffect(() => {
    setActiveIndex(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [resetKey]);

  const activeReel = reels[activeIndex];
  const canPlay = playbackEnabled && appActive && height > 0;

  useEffect(() => {
    if (activeReel && canPlay) onReelActivated?.(activeReel);
    // Only when the centered reel changes (or playback resumes), not on every like.
  }, [activeReel?.id, canPlay]); // eslint-disable-line react-hooks/exhaustive-deps

  const openComments = useCallback((reel: Reel) => setCommentsFor(reel), []);
  const closeComments = useCallback(() => setCommentsFor(null), []);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Reel>) => (
      <ReelPlayer
        reel={item}
        height={height}
        isActive={canPlay && index === activeIndex}
        shouldPreload={Math.abs(index - activeIndex) === 1}
        bottomInset={bottomInset}
        onLike={toggleLike}
        onComment={openComments}
        onShare={share}
        onSave={toggleSave}
        onLockedPress={onLockedPress}
        onPlaybackExpired={onPlaybackExpired}
      />
    ),
    [
      height,
      canPlay,
      activeIndex,
      bottomInset,
      toggleLike,
      openComments,
      share,
      toggleSave,
      onLockedPress,
      onPlaybackExpired,
    ],
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<Reel> | null | undefined, index: number) => ({ length: height, offset: height * index, index }),
    [height],
  );

  // Keep the comment sheet's header count in sync with the list.
  const commentsReel = commentsFor ? (reels.find((reel) => reel.id === commentsFor.id) ?? commentsFor) : null;

  return (
    <View className="flex-1 bg-black" onLayout={handleLayout}>
      {height > 0 ? (
        <FlatList
          ref={listRef}
          data={reels}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={activeIndex}
          pagingEnabled
          decelerationRate="fast"
          snapToAlignment="start"
          showsVerticalScrollIndicator={false}
          getItemLayout={getItemLayout}
          initialScrollIndex={initialIndex > 0 && initialIndex < reels.length ? initialIndex : undefined}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY_CONFIG}
          onEndReached={onEndReached}
          onEndReachedThreshold={2}
          // Memory: only a few full-screen players alive at once.
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          removeClippedSubviews
          refreshControl={
            onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" /> : undefined
          }
          ListFooterComponent={ListFooterComponent}
        />
      ) : null}

      <CommentsSheet reel={commentsReel} onClose={closeComments} onCommentPosted={incrementComments} />
    </View>
  );
}
