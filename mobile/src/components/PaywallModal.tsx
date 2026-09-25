import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, describeError, type PaywallTrigger } from '../api/client';
import { createCheckoutSession, fetchPlan, verifyCheckout } from '../api/payments';
import { colors } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import type { CheckoutSession, PlanDisplay } from '../types/api';
import { RazorpayCheckout, type CheckoutResult } from './RazorpayCheckout';

type Stage = 'idle' | 'starting' | 'checkout' | 'verifying' | 'success';

interface PaywallModalProps {
  visible: boolean;
  trigger: PaywallTrigger | null;
  onClose: () => void;
  onSubscribed: () => Promise<void> | void;
}

const BENEFITS: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string }[] = [
  { icon: 'infinite', title: 'Unlimited reels', subtitle: 'History, Polity, Geography & Science — no caps' },
  { icon: 'sparkles', title: 'Fresh lessons every day', subtitle: 'Bite-sized explainers from expert educators' },
  { icon: 'bookmark', title: 'Save & revise anytime', subtitle: 'Build your personal revision library' },
  { icon: 'shield-checkmark', title: 'Cancel anytime', subtitle: 'Secure recurring billing via Razorpay' },
];

function formatPrice(plan: PlanDisplay | null): string {
  if (!plan) return '—';
  const rupees = plan.amountPaise / 100;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: rupees % 1 === 0 ? 0 : 2 })}`;
}

/**
 * Premium upsell shown the instant the API answers 403 SUBSCRIPTION_REQUIRED.
 * "Unlock Unlimited Learning" creates a Razorpay subscription on the backend,
 * opens Razorpay Standard Checkout, then verifies the signed result so access
 * unlocks immediately (the webhook confirms it server-side).
 */
export function PaywallModal({ visible, trigger, onClose, onSubscribed }: PaywallModalProps) {
  const insets = useSafeAreaInsets();
  const { profile, refreshProfile } = useAuth();

  const [plan, setPlan] = useState<PlanDisplay | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const access = trigger?.access ?? profile?.access ?? null;
  const limit = access?.freeReelLimit ?? 0;
  const watched = Math.min(access?.freeReelsWatched ?? limit, limit);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setStage('idle');
    let cancelled = false;
    fetchPlan()
      .then((response) => {
        if (!cancelled) setPlan(response.plan);
      })
      .catch(() => {
        // Price is informational; checkout still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const completeSubscription = useCallback(async () => {
    setStage('success');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setTimeout(() => {
      void onSubscribed();
    }, 1200);
  }, [onSubscribed]);

  const startCheckout = useCallback(async () => {
    setError(null);
    setStage('starting');
    try {
      const checkout = await createCheckoutSession();
      setSession(checkout);
      setStage('checkout');
    } catch (checkoutError) {
      if (checkoutError instanceof ApiError && checkoutError.status === 409) {
        // Already subscribed (e.g. purchased on another device).
        await refreshProfile();
        await completeSubscription();
        return;
      }
      setError(describeError(checkoutError));
      setStage('idle');
    }
  }, [completeSubscription, refreshProfile]);

  const handleCheckoutResult = useCallback(
    async (result: CheckoutResult) => {
      setSession(null);

      if (result.type === 'dismissed') {
        setStage('idle');
        return;
      }
      if (result.type === 'failed') {
        setError(result.message);
        setStage('idle');
        return;
      }

      setStage('verifying');
      try {
        await verifyCheckout(result.payload);
        await completeSubscription();
      } catch (verifyError) {
        setError(
          `${describeError(verifyError)} If you were charged, tap “I've already paid” — your access will be restored automatically.`,
        );
        setStage('idle');
      }
    },
    [completeSubscription],
  );

  const restore = useCallback(async () => {
    setError(null);
    setStage('verifying');
    const latest = await refreshProfile();
    if (latest?.subscription.active) {
      await completeSubscription();
    } else {
      setError('We could not find an active subscription yet. Payments can take a minute to confirm.');
      setStage('idle');
    }
  }, [completeSubscription, refreshProfile]);

  const busy = stage === 'starting' || stage === 'verifying' || stage === 'checkout';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={busy ? undefined : onClose}>
      <LinearGradient colors={['#2E1065', '#12081F', '#07060B']} locations={[0, 0.45, 1]} style={{ flex: 1 }}>
        {stage === 'success' ? (
          <View className="flex-1 items-center justify-center px-10">
            <View className="h-24 w-24 items-center justify-center rounded-full bg-green-500/20">
              <Ionicons name="checkmark-circle" size={64} color={colors.success} />
            </View>
            <Text className="mt-6 text-center text-3xl font-extrabold text-white">You're Premium!</Text>
            <Text className="mt-2 text-center text-base text-ink-300">Unlimited learning is now unlocked.</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}
            contentContainerClassName="px-6"
            bounces={false}
          >
            <View className="flex-row justify-end">
              <Pressable
                onPress={onClose}
                disabled={busy}
                hitSlop={12}
                className="h-9 w-9 items-center justify-center rounded-full bg-white/10"
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={20} color="#fff" />
              </Pressable>
            </View>

            <View className="mt-2 items-center">
              <LinearGradient
                colors={['#FBBF24', '#F59E0B']}
                style={{ width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="school" size={38} color="#1F1300" />
              </LinearGradient>
              <Text className="mt-4 text-xs font-bold uppercase tracking-[3px] text-gold">EduShorts Premium</Text>
              <Text className="mt-2 text-center text-[32px] font-extrabold leading-9 text-white">
                Unlock Unlimited Learning
              </Text>
              <Text className="mt-3 text-center text-base leading-6 text-ink-300">
                {trigger?.message ?? 'Go beyond the free preview and learn without limits.'}
              </Text>
            </View>

            {limit > 0 ? (
              <View className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-white">Free reels used</Text>
                  <Text className="text-sm font-bold text-white">
                    {watched}/{limit}
                  </Text>
                </View>
                <View className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/10">
                  <View className="h-full rounded-full bg-brand-500" style={{ width: `${(watched / limit) * 100}%` }} />
                </View>
              </View>
            ) : null}

            <View className="mt-6 gap-4">
              {BENEFITS.map((benefit) => (
                <View key={benefit.title} className="flex-row items-center">
                  <View className="mr-4 h-11 w-11 items-center justify-center rounded-xl bg-brand-600/25">
                    <Ionicons name={benefit.icon} size={22} color={colors.brandLight} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-bold text-white">{benefit.title}</Text>
                    <Text className="text-sm text-ink-300">{benefit.subtitle}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View className="mt-7 items-center rounded-2xl border-2 border-brand-500 bg-brand-600/15 px-5 py-4">
              <Text className="text-sm font-semibold text-brand-300">Premium plan</Text>
              <View className="mt-1 flex-row items-end">
                <Text className="text-4xl font-extrabold text-white">{formatPrice(plan)}</Text>
                <Text className="mb-1.5 ml-1 text-base text-ink-300">/{plan?.interval ?? 'month'}</Text>
              </View>
              <Text className="mt-1 text-xs text-ink-300">Auto-renews · Cancel anytime from your profile</Text>
            </View>

            {error ? (
              <View className="mt-4 flex-row rounded-xl bg-red-500/15 p-3">
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text className="ml-2 flex-1 text-sm text-red-200">{error}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={startCheckout}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Unlock Unlimited Learning"
              className="mt-6 overflow-hidden rounded-2xl active:opacity-90"
            >
              <LinearGradient
                colors={['#8B5CF6', '#6D28D9']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ paddingVertical: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}
              >
                {busy ? (
                  <>
                    <ActivityIndicator color="#fff" />
                    <Text className="ml-3 text-lg font-bold text-white">
                      {stage === 'verifying' ? 'Confirming payment…' : 'Opening secure checkout…'}
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="lock-open" size={20} color="#fff" />
                    <Text className="ml-2 text-lg font-bold text-white">Unlock Unlimited Learning</Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>

            <View className="mt-4 flex-row items-center justify-center">
              <Ionicons name="lock-closed" size={12} color={colors.textFaint} />
              <Text className="ml-1.5 text-xs text-ink-500">Payments secured by Razorpay · UPI, cards & netbanking</Text>
            </View>

            <Pressable onPress={restore} disabled={busy} className="mt-5 items-center py-2" accessibilityRole="button">
              <Text className="text-sm font-semibold text-brand-300">I've already paid</Text>
            </Pressable>
          </ScrollView>
        )}
      </LinearGradient>

      <RazorpayCheckout session={session} onResult={handleCheckoutResult} />
    </Modal>
  );
}
