import * as Haptics from 'expo-haptics';
import { useCallback, useRef } from 'react';
import { Alert, Platform, Share } from 'react-native';
import { describeError } from '../api/client';
import { setLiked, setSaved } from '../api/reels';
import { config } from '../config/env';
import type { Reel } from '../types/api';
import type { ReelUpdater } from './useFeed';

type UpdateReel = (id: string, updater: ReelUpdater) => void;

/**
 * Like/save are optimistic. Requests for the same reel are serialised and the
 * latest desired state always wins, so rapid double-taps can't desync counts.
 */
function useSerialToggle(send: (id: string, value: boolean) => Promise<void>) {
  const inFlight = useRef(new Map<string, boolean>());
  const pending = useRef(new Map<string, boolean>());

  const run = useCallback(
    async (id: string, value: boolean): Promise<void> => {
      if (inFlight.current.has(id)) {
        pending.current.set(id, value);
        return;
      }
      inFlight.current.set(id, value);
      try {
        await send(id, value);
      } finally {
        inFlight.current.delete(id);
        const next = pending.current.get(id);
        pending.current.delete(id);
        if (next !== undefined && next !== value) await run(id, next);
      }
    },
    [send],
  );

  return run;
}

export function useReelActions(updateReel: UpdateReel) {
  const sendLike = useCallback(
    async (id: string, liked: boolean) => {
      try {
        const result = await setLiked(id, liked);
        updateReel(id, (reel) => (reel.isLiked === result.liked ? { ...reel, likesCount: result.likesCount } : reel));
      } catch (error) {
        updateReel(id, (reel) => ({
          ...reel,
          isLiked: !liked,
          likesCount: Math.max(reel.likesCount + (liked ? -1 : 1), 0),
        }));
        console.warn('Like failed', describeError(error));
      }
    },
    [updateReel],
  );

  const sendSave = useCallback(
    async (id: string, saved: boolean) => {
      try {
        await setSaved(id, saved);
      } catch (error) {
        updateReel(id, (reel) => ({ ...reel, isSaved: !saved }));
        Alert.alert('Could not update saved reels', describeError(error));
      }
    },
    [updateReel],
  );

  const likeQueue = useSerialToggle(sendLike);
  const saveQueue = useSerialToggle(sendSave);

  const toggleLike = useCallback(
    (target: Reel) => {
      const liked = !target.isLiked;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      updateReel(target.id, (reel) => ({
        ...reel,
        isLiked: liked,
        likesCount: Math.max(reel.likesCount + (liked ? 1 : -1), 0),
      }));
      void likeQueue(target.id, liked);
    },
    [likeQueue, updateReel],
  );

  const toggleSave = useCallback(
    (target: Reel) => {
      const saved = !target.isSaved;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      updateReel(target.id, (reel) => ({ ...reel, isSaved: saved }));
      void saveQueue(target.id, saved);
    },
    [saveQueue, updateReel],
  );

  const share = useCallback(async (reel: Reel) => {
    const url = `${config.shareBaseUrl}/${reel.id}`;
    try {
      await Share.share(
        Platform.OS === 'ios'
          ? { message: `${reel.title} — learn it in 60 seconds on EduShorts`, url }
          : { message: `${reel.title} — learn it in 60 seconds on EduShorts\n${url}`, title: reel.title },
        { dialogTitle: 'Share this reel', subject: reel.title },
      );
    } catch (error) {
      Alert.alert('Could not share', describeError(error));
    }
  }, []);

  const incrementComments = useCallback(
    (id: string) => updateReel(id, (reel) => ({ ...reel, commentsCount: reel.commentsCount + 1 })),
    [updateReel],
  );

  return { toggleLike, toggleSave, share, incrementComments };
}
