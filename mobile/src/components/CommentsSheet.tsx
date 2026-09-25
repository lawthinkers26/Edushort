import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../api/client';
import { fetchComments, postComment } from '../api/reels';
import { colors } from '../constants/theme';
import type { Comment, Reel } from '../types/api';

const SHEET_HEIGHT = Math.round(Dimensions.get('window').height * 0.68);
const DISMISS_DISTANCE = 120;

interface CommentsSheetProps {
  reel: Reel | null;
  onClose: () => void;
  onCommentPosted: (reelId: string) => void;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function CommentRow({ comment }: { comment: Comment }) {
  const initial = comment.author.displayName.charAt(0).toUpperCase() || '?';
  return (
    <View className="flex-row px-5 py-3">
      <View className="mr-3 h-9 w-9 items-center justify-center rounded-full bg-brand-600/30">
        <Text className="font-bold text-brand-300">{initial}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-xs font-semibold text-ink-300">
          {comment.isMine ? 'You' : comment.author.displayName}
          <Text className="font-normal text-ink-500">{`  ·  ${timeAgo(comment.createdAt)}`}</Text>
        </Text>
        <Text className="mt-0.5 text-[15px] leading-5 text-white">{comment.body}</Text>
      </View>
    </View>
  );
}

/**
 * Modern bottom sheet: slides up over a dimmed backdrop, drag-handle to
 * dismiss, infinite-scrolling comments and a keyboard-aware composer.
 */
export function CommentsSheet({ reel, onClose, onCommentPosted }: CommentsSheetProps) {
  const insets = useSafeAreaInsets();
  const visible = reel !== null;

  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const activeReelId = useRef<string | null>(null);

  const animateTo = useCallback(
    (open: boolean, onDone?: () => void) => {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: open ? 0 : SHEET_HEIGHT,
          damping: 22,
          stiffness: 220,
          mass: 0.8,
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, { toValue: open ? 1 : 0, duration: 200, useNativeDriver: true }),
      ]).start(() => onDone?.());
    },
    [backdrop, translateY],
  );

  const close = useCallback(() => {
    Keyboard.dismiss();
    animateTo(false, onClose);
  }, [animateTo, onClose]);

  const loadFirstPage = useCallback(async (reelId: string) => {
    activeReelId.current = reelId;
    setLoading(true);
    setError(null);
    setComments([]);
    setCursor(null);
    try {
      const page = await fetchComments(reelId);
      if (activeReelId.current !== reelId) return;
      setComments(page.items);
      setCursor(page.nextCursor);
    } catch (loadError) {
      if (activeReelId.current === reelId) setError(describeError(loadError));
    } finally {
      if (activeReelId.current === reelId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!reel) return;
    translateY.setValue(SHEET_HEIGHT);
    backdrop.setValue(0);
    animateTo(true);
    setDraft('');
    void loadFirstPage(reel.id);
  }, [reel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (!reel || !cursor || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const page = await fetchComments(reel.id, cursor);
      if (activeReelId.current !== reel.id) return;
      setComments((current) => {
        const seen = new Set(current.map((comment) => comment.id));
        return [...current, ...page.items.filter((comment) => !seen.has(comment.id))];
      });
      setCursor(page.nextCursor);
    } catch (loadError) {
      setError(describeError(loadError));
    } finally {
      setLoadingMore(false);
    }
  }, [reel, cursor, loadingMore, loading]);

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!reel || !body || posting) return;
    setPosting(true);
    setError(null);
    try {
      const comment = await postComment(reel.id, body);
      setComments((current) => [comment, ...current]);
      setDraft('');
      onCommentPosted(reel.id);
    } catch (postError) {
      setError(describeError(postError));
    } finally {
      setPosting(false);
    }
  }, [draft, onCommentPosted, posting, reel]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => {
        if (gesture.dy > 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE || gesture.vy > 1.2) {
          Keyboard.dismiss();
          Animated.timing(translateY, { toValue: SHEET_HEIGHT, duration: 180, useNativeDriver: true }).start(() =>
            onCloseRef.current(),
          );
          Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: true }).start();
        } else {
          Animated.spring(translateY, { toValue: 0, damping: 20, stiffness: 240, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  // PanResponder is created once; keep the latest onClose reachable from it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={{ opacity: backdrop }} className="absolute inset-0 bg-black/60">
        <Pressable className="flex-1" onPress={close} accessibilityLabel="Close comments" />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
        pointerEvents="box-none"
      >
        <Animated.View
          style={{ height: SHEET_HEIGHT, transform: [{ translateY }] }}
          className="overflow-hidden rounded-t-3xl bg-ink-900"
        >
          <View {...panResponder.panHandlers} className="items-center border-b border-ink-700 pb-3 pt-2.5">
            <View className="mb-3 h-1.5 w-10 rounded-full bg-ink-500" />
            <Text className="text-base font-bold text-white">
              {reel ? `${reel.commentsCount.toLocaleString()} comments` : 'Comments'}
            </Text>
            <Pressable onPress={close} hitSlop={12} className="absolute right-4 top-4" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color={colors.brandLight} />
            </View>
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <CommentRow comment={item} />}
              onEndReached={loadMore}
              onEndReachedThreshold={0.4}
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="py-2"
              ListEmptyComponent={
                <View className="items-center px-10 pt-16">
                  <Ionicons name="chatbubbles-outline" size={40} color={colors.textFaint} />
                  <Text className="mt-3 text-center text-ink-300">
                    {error ? error : 'No comments yet. Start the discussion!'}
                  </Text>
                  {error && reel ? (
                    <Pressable onPress={() => void loadFirstPage(reel.id)} className="mt-3">
                      <Text className="font-semibold text-brand-400">Retry</Text>
                    </Pressable>
                  ) : null}
                </View>
              }
              ListFooterComponent={loadingMore ? <ActivityIndicator className="py-4" color={colors.brandLight} /> : null}
            />
          )}

          {error && comments.length > 0 ? <Text className="px-5 pb-1 text-xs text-red-400">{error}</Text> : null}

          <View
            className="flex-row items-end border-t border-ink-700 bg-ink-900 px-4 pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a comment…"
              placeholderTextColor={colors.textFaint}
              multiline
              maxLength={500}
              className="max-h-28 flex-1 rounded-2xl bg-ink-800 px-4 py-2.5 text-[15px] text-white"
              accessibilityLabel="Comment text"
            />
            <Pressable
              onPress={submit}
              disabled={!draft.trim() || posting}
              className={`ml-2 h-10 w-10 items-center justify-center rounded-full ${
                draft.trim() && !posting ? 'bg-brand-600' : 'bg-ink-700'
              }`}
              accessibilityRole="button"
              accessibilityLabel="Post comment"
            >
              {posting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="arrow-up" size={20} color="#fff" />}
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
