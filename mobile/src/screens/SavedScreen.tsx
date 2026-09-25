import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, Image, Modal, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../api/client';
import { fetchReel, fetchSavedReels, recordView } from '../api/reels';
import { formatCount } from '../components/ReelOverlay';
import { ReelSwiper } from '../components/ReelSwiper';
import { colors } from '../constants/theme';
import { usePaywall } from '../context/PaywallContext';
import type { ReelUpdater } from '../hooks/useFeed';
import type { Reel } from '../types/api';

const COLUMNS = 3;
const GAP = 2;
const TILE_WIDTH = (Dimensions.get('window').width - GAP * (COLUMNS - 1)) / COLUMNS;

export function SavedScreen() {
  const insets = useSafeAreaInsets();
  const { openPaywall, visible: paywallVisible } = usePaywall();
  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerIndex, setPlayerIndex] = useState<number | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const response = await fetchSavedReels();
      setReels(response.items);
      setError(null);
    } catch (loadError) {
      setError(describeError(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload whenever the tab gains focus (saves happen on the feed).
  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  const updateReel = useCallback((id: string, updater: ReelUpdater) => {
    setReels((current) => current.map((reel) => (reel.id === id ? updater(reel) : reel)));
  }, []);

  const handleExpired = useCallback(
    async (reel: Reel) => {
      try {
        const response = await fetchReel(reel.id);
        updateReel(reel.id, () => response.reel);
      } catch (refreshError) {
        console.warn('Could not refresh reel', describeError(refreshError));
      }
    },
    [updateReel],
  );

  // Saved reels count against the free allowance like any other view.
  const viewedIds = useRef(new Set<string>());
  const handleActivated = useCallback((reel: Reel) => {
    if (viewedIds.current.has(reel.id) || reel.locked) return;
    viewedIds.current.add(reel.id);
    recordView(reel.id).catch(() => {
      // 403 opens the paywall through the API event bus; allow retry for other errors.
      viewedIds.current.delete(reel.id);
    });
  }, []);

  const closePlayer = useCallback(() => {
    setPlayerIndex(null);
    // Drop reels that were un-saved while watching.
    setReels((current) => current.filter((reel) => reel.isSaved));
  }, []);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-ink-950">
        <ActivityIndicator color={colors.brandLight} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-ink-950" style={{ paddingTop: insets.top }}>
      <View className="px-5 pb-3 pt-2">
        <Text className="text-2xl font-extrabold text-white">Saved</Text>
        <Text className="mt-0.5 text-sm text-ink-300">Your revision library</Text>
      </View>

      <FlatList
        data={reels}
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor="#fff" />
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => (item.locked ? openPaywall() : setPlayerIndex(index))}
            style={{ width: TILE_WIDTH, height: TILE_WIDTH * 1.6 }}
            className="overflow-hidden bg-ink-800"
            accessibilityRole="button"
            accessibilityLabel={`Play ${item.title}`}
          >
            {item.playback ? (
              <Image source={{ uri: item.playback.thumbnailUrl }} className="absolute inset-0" resizeMode="cover" />
            ) : null}
            <View className="absolute inset-0 justify-end bg-black/20 p-2">
              {item.locked ? (
                <View className="absolute right-2 top-2">
                  <Ionicons name="lock-closed" size={16} color="#fff" />
                </View>
              ) : null}
              <Text className="text-xs font-semibold text-white" numberOfLines={2}>
                {item.title}
              </Text>
              <View className="mt-1 flex-row items-center">
                <Ionicons name="heart" size={11} color="#fff" />
                <Text className="ml-1 text-[11px] text-white/85">{formatCount(item.likesCount)}</Text>
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center px-10">
            <Ionicons name="bookmark-outline" size={44} color={colors.textFaint} />
            <Text className="mt-3 text-center text-base font-semibold text-white">
              {error ? "Couldn't load your saved reels" : 'Nothing saved yet'}
            </Text>
            <Text className="mt-1 text-center text-sm text-ink-300">
              {error ?? 'Tap the bookmark on any reel to revise it later.'}
            </Text>
          </View>
        }
      />

      <Modal visible={playerIndex !== null} animationType="slide" onRequestClose={closePlayer}>
        <View className="flex-1 bg-black">
          {playerIndex !== null ? (
            <ReelSwiper
              reels={reels}
              initialIndex={playerIndex}
              playbackEnabled={!paywallVisible}
              updateReel={updateReel}
              onReelActivated={handleActivated}
              onLockedPress={() => openPaywall()}
              onPlaybackExpired={handleExpired}
              bottomInset={insets.bottom}
            />
          ) : null}
          <Pressable
            onPress={closePlayer}
            hitSlop={12}
            className="absolute left-4 h-10 w-10 items-center justify-center rounded-full bg-black/40"
            style={{ top: insets.top + 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close player"
          >
            <Ionicons name="chevron-down" size={24} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
