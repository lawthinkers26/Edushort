import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../api/client';
import { cancelSubscription } from '../api/payments';
import { colors } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { usePaywall } from '../context/PaywallContext';

function formatDate(iso: string | null): string {
  if (!iso) return 'No expiry';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Row({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center px-4 py-4 active:bg-white/5" accessibilityRole="button">
      <Ionicons name={icon} size={20} color={destructive ? colors.danger : colors.textMuted} />
      <Text className={`ml-3 flex-1 text-base ${destructive ? 'text-red-400' : 'text-white'}`}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile, profileLoading, profileError, refreshProfile, signOut } = useAuth();
  const { openPaywall } = usePaywall();
  const [cancelling, setCancelling] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshProfile();
    }, [refreshProfile]),
  );

  const subscribed = profile?.subscription.active ?? false;
  const cancelScheduled = profile?.subscription.razorpayState === 'cancelled';
  const access = profile?.access;
  const name = profile?.displayName ?? user?.displayName ?? user?.email?.split('@')[0] ?? 'Learner';

  const confirmCancel = useCallback(() => {
    Alert.alert(
      'Cancel subscription?',
      `You'll keep Premium until ${formatDate(profile?.subscription.expiresAt ?? null)}. No further charges will be made.`,
      [
        { text: 'Keep Premium', style: 'cancel' },
        {
          text: 'Cancel subscription',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await cancelSubscription();
              await refreshProfile();
              Alert.alert('Subscription cancelled', 'Your access continues until the end of the billing period.');
            } catch (error) {
              Alert.alert('Could not cancel', describeError(error));
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  }, [profile?.subscription.expiresAt, refreshProfile]);

  const confirmSignOut = useCallback(() => {
    Alert.alert('Sign out?', undefined, [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          signOut().catch((error: unknown) => Alert.alert('Sign out failed', describeError(error)));
        },
      },
    ]);
  }, [signOut]);

  return (
    <ScrollView
      className="flex-1 bg-ink-950"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl refreshing={profileLoading} onRefresh={() => void refreshProfile()} tintColor="#fff" />
      }
    >
      <View className="items-center px-6">
        <View className="h-20 w-20 items-center justify-center rounded-full bg-brand-600">
          <Text className="text-3xl font-extrabold text-white">{name.charAt(0).toUpperCase()}</Text>
        </View>
        <Text className="mt-3 text-xl font-bold text-white">{name}</Text>
        <Text className="text-sm text-ink-300">{user?.email}</Text>
        {subscribed ? (
          <View className="mt-3 flex-row items-center rounded-full bg-gold/15 px-3 py-1">
            <Ionicons name="star" size={12} color={colors.save} />
            <Text className="ml-1 text-xs font-bold text-gold">PREMIUM</Text>
          </View>
        ) : null}
      </View>

      {profileError ? <Text className="mx-6 mt-4 text-center text-sm text-red-400">{profileError}</Text> : null}

      <View className="mx-5 mt-6 rounded-2xl border border-ink-700 bg-ink-900 p-5">
        {subscribed ? (
          <>
            <Text className="text-base font-bold text-white">EduShorts Premium</Text>
            <Text className="mt-1 text-sm text-ink-300">
              {cancelScheduled ? 'Ends on ' : 'Renews on '}
              {formatDate(profile?.subscription.expiresAt ?? null)}
            </Text>
            <Text className="mt-3 text-sm text-ink-300">Unlimited reels across every category.</Text>
          </>
        ) : (
          <>
            <Text className="text-base font-bold text-white">Free plan</Text>
            {access ? (
              <>
                <Text className="mt-1 text-sm text-ink-300">
                  {access.freeReelsWatched} of {access.freeReelLimit} free reels watched
                </Text>
                <View className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                  <View
                    className="h-full rounded-full bg-brand-500"
                    style={{
                      width: `${access.freeReelLimit > 0 ? Math.min(access.freeReelsWatched / access.freeReelLimit, 1) * 100 : 100}%`,
                    }}
                  />
                </View>
              </>
            ) : (
              <ActivityIndicator className="mt-3" color={colors.brandLight} />
            )}
            <Pressable onPress={() => openPaywall()} className="mt-4 items-center rounded-xl bg-brand-600 py-3 active:opacity-80">
              <Text className="font-bold text-white">Unlock Unlimited Learning</Text>
            </Pressable>
          </>
        )}
      </View>

      <View className="mx-5 mt-6 overflow-hidden rounded-2xl border border-ink-700 bg-ink-900">
        <View className="flex-row justify-around border-b border-ink-700 py-4">
          <View className="items-center">
            <Text className="text-lg font-bold text-white">{profile?.likedCount ?? 0}</Text>
            <Text className="text-xs text-ink-300">Liked</Text>
          </View>
          <View className="items-center">
            <Text className="text-lg font-bold text-white">{profile?.savedCount ?? 0}</Text>
            <Text className="text-xs text-ink-300">Saved</Text>
          </View>
        </View>
        {subscribed && !cancelScheduled ? (
          cancelling ? (
            <ActivityIndicator className="py-4" color={colors.brandLight} />
          ) : (
            <Row icon="close-circle-outline" label="Cancel subscription" onPress={confirmCancel} />
          )
        ) : null}
        <Row icon="log-out-outline" label="Sign out" onPress={confirmSignOut} destructive />
      </View>
    </ScrollView>
  );
}
