import { Ionicons } from '@expo/vector-icons';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/theme';
import type { Reel } from '../types/api';
import { ReelOverlay } from './ReelOverlay';

const DOUBLE_TAP_MS = 260;

export interface ReelPlayerProps {
  reel: Reel;
  height: number;
  /** Centered in the viewport and allowed to play. */
  isActive: boolean;
  /** Adjacent to the active reel: load the stream so playback starts instantly. */
  shouldPreload: boolean;
  bottomInset: number;
  onLike: (reel: Reel) => void;
  onComment: (reel: Reel) => void;
  onShare: (reel: Reel) => void;
  onSave: (reel: Reel) => void;
  onLockedPress: (reel: Reel) => void;
  /** Signed stream URL expired — parent should fetch fresh playback URLs. */
  onPlaybackExpired: (reel: Reel) => void;
}

function ProgressBar({ player }: { player: VideoPlayer }) {
  const [progress, setProgress] = useState(0);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const duration = player.duration;
    setProgress(duration > 0 ? Math.min(currentTime / duration, 1) : 0);
  });

  return (
    <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/20">
      <View className="h-full bg-white" style={{ width: `${progress * 100}%` }} />
    </View>
  );
}

function ReelPlayerComponent({
  reel,
  height,
  isActive,
  shouldPreload,
  bottomInset,
  onLike,
  onComment,
  onShare,
  onSave,
  onLockedPress,
  onPlaybackExpired,
}: ReelPlayerProps) {
  const streamUri = reel.playback && (isActive || shouldPreload) ? reel.playback.hlsUrl : null;

  const player = useVideoPlayer(null, (instance) => {
    instance.loop = true;
    instance.muted = false;
    instance.timeUpdateEventInterval = 0.25;
    instance.keepScreenOnWhilePlaying = true;
    instance.showNowPlayingNotification = false;
    instance.staysActiveInBackground = false;
  });

  const loadedUri = useRef<string | null>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  // Load (or swap) the HLS source once the reel is active or adjacent.
  useEffect(() => {
    if (!streamUri || loadedUri.current === streamUri) return;
    loadedUri.current = streamUri;
    setFirstFrameRendered(false);
    setLoadError(null);
    player.replaceAsync({ uri: streamUri, contentType: 'hls' }).catch((replaceError: unknown) => {
      loadedUri.current = null;
      setLoadError(replaceError instanceof Error ? replaceError.message : 'Could not load video');
    });
  }, [player, streamUri]);

  // Autoplay when centered; pause (and rewind) the moment it leaves the viewport.
  useEffect(() => {
    try {
      if (isActive && !userPaused && streamUri) {
        player.play();
      } else {
        player.pause();
      }
    } catch (playbackError) {
      console.warn('Playback toggle failed', playbackError);
    }
  }, [isActive, userPaused, streamUri, player]);

  useEffect(() => {
    if (!isActive) {
      setUserPaused(false);
      try {
        player.currentTime = 0;
      } catch {
        // Player may not have a source yet.
      }
    }
  }, [isActive, player]);

  // Surface errors; if the signed URL expired, ask the parent for fresh URLs.
  useEffect(() => {
    if (status !== 'error') return;
    const expiresAt = reel.playback?.expiresAt;
    if (expiresAt && expiresAt * 1000 <= Date.now() + 5_000) {
      loadedUri.current = null;
      onPlaybackExpired(reel);
      return;
    }
    setLoadError(error?.message ?? 'Playback failed');
  }, [status, error, reel, onPlaybackExpired]);

  const retry = useCallback(() => {
    loadedUri.current = null;
    setLoadError(null);
    if (reel.playback?.expiresAt && reel.playback.expiresAt * 1000 <= Date.now()) {
      onPlaybackExpired(reel);
      return;
    }
    if (streamUri) {
      loadedUri.current = streamUri;
      player.replaceAsync({ uri: streamUri, contentType: 'hls' }).catch(() => setLoadError('Could not load video'));
    }
  }, [player, reel, streamUri, onPlaybackExpired]);

  // ---------------------------------------------------------------------------
  // Gestures: single tap = pause/resume, double tap = like (with heart burst)
  // ---------------------------------------------------------------------------
  const lastTap = useRef(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartScale = useRef(new Animated.Value(0)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;

  useEffect(
    () => () => {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    },
    [],
  );

  const burstHeart = useCallback(() => {
    heartScale.setValue(0.4);
    heartOpacity.setValue(1);
    Animated.parallel([
      Animated.spring(heartScale, { toValue: 1.15, friction: 4, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(450),
        Animated.timing(heartOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]),
    ]).start();
  }, [heartOpacity, heartScale]);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      burstHeart();
      if (!reel.isLiked) onLike(reel);
      return;
    }
    lastTap.current = now;
    singleTapTimer.current = setTimeout(() => setUserPaused((paused) => !paused), DOUBLE_TAP_MS);
  }, [burstHeart, onLike, reel]);

  const buffering = Boolean(streamUri) && (status === 'loading' || (isActive && !firstFrameRendered)) && !loadError;

  if (reel.locked || !reel.playback) {
    return (
      <View style={{ height }} className="items-center justify-center bg-ink-950 px-10">
        <View className="mb-5 h-20 w-20 items-center justify-center rounded-full bg-brand-600/20">
          <Ionicons name="lock-closed" size={36} color={colors.brandLight} />
        </View>
        <Text className="text-center text-xl font-bold text-white">{reel.title}</Text>
        <Text className="mt-2 text-center text-sm text-ink-300">Subscribe to keep watching this reel.</Text>
        <Pressable
          onPress={() => onLockedPress(reel)}
          className="mt-6 rounded-full bg-brand-600 px-6 py-3 active:opacity-80"
          accessibilityRole="button"
        >
          <Text className="font-bold text-white">Unlock Unlimited Learning</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ height }} className="overflow-hidden bg-black">
      <Pressable onPress={handleTap} style={StyleSheet.absoluteFill} accessibilityLabel="Tap to pause, double tap to like">
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
          surfaceType={Platform.OS === 'android' ? 'textureView' : undefined}
          onFirstFrameRender={() => setFirstFrameRendered(true)}
        />

        {!firstFrameRendered ? (
          <Image
            source={{ uri: reel.playback.thumbnailUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </Pressable>

      {buffering ? (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : null}

      {userPaused && !isPlaying && !loadError ? (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-black/40">
            <Ionicons name="play" size={44} color="#fff" style={{ marginLeft: 6 }} />
          </View>
        </View>
      ) : null}

      {loadError ? (
        <View className="absolute inset-0 items-center justify-center bg-black/60 px-10">
          <Ionicons name="cloud-offline-outline" size={40} color="#fff" />
          <Text className="mt-3 text-center text-white">Couldn't play this reel.</Text>
          <Pressable onPress={retry} className="mt-4 rounded-full border border-white/40 px-5 py-2" accessibilityRole="button">
            <Text className="font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      ) : null}

      <Animated.View
        pointerEvents="none"
        style={[styles.heart, { opacity: heartOpacity, transform: [{ scale: heartScale }] }]}
      >
        <Ionicons name="heart" size={110} color={colors.like} />
      </Animated.View>

      <ReelOverlay
        reel={reel}
        bottomInset={bottomInset}
        onLike={() => onLike(reel)}
        onComment={() => onComment(reel)}
        onShare={() => onShare(reel)}
        onSave={() => onSave(reel)}
      />

      {isActive ? <ProgressBar player={player} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heart: {
    position: 'absolute',
    top: '38%',
    alignSelf: 'center',
  },
});

export const ReelPlayer = memo(ReelPlayerComponent);
