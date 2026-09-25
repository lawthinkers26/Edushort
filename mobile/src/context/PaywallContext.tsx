import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onSubscriptionRequired, type PaywallTrigger } from '../api/client';
import { PaywallModal } from '../components/PaywallModal';
import { useAuth } from './AuthContext';

interface PaywallContextValue {
  /** Paywall modal currently on screen. */
  visible: boolean;
  /** The feed is blocked until the user subscribes. */
  blocked: boolean;
  trigger: PaywallTrigger | null;
  /** Bumps after a successful purchase so screens can reload with full access. */
  entitlementVersion: number;
  openPaywall: (trigger?: PaywallTrigger) => void;
  closePaywall: () => void;
}

const PaywallContext = createContext<PaywallContextValue | null>(null);

export function PaywallProvider({ children }: { children: ReactNode }) {
  const { refreshProfile, profile } = useAuth();
  const [visible, setVisible] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [trigger, setTrigger] = useState<PaywallTrigger | null>(null);
  const [entitlementVersion, setEntitlementVersion] = useState(0);

  const blockedRef = useRef(false);

  // Any 403 SUBSCRIPTION_REQUIRED from the API blocks the feed immediately.
  useEffect(
    () =>
      onSubscriptionRequired((next) => {
        blockedRef.current = true;
        setTrigger(next);
        setBlocked(true);
        setVisible(true);
        // Keep the profile screen's counters in sync with the server's verdict.
        void refreshProfile();
      }),
    [refreshProfile],
  );

  // A freshly loaded profile that has access again (subscription bought on
  // another device, or the admin raised the free limit) lifts the block.
  // Reacts only to profile loads, so a stale profile can't undo a new 403.
  useEffect(() => {
    if (!profile || !blockedRef.current) return;
    const unlocked = profile.subscription.active || (profile.access.freeReelsRemaining ?? 0) > 0;
    if (unlocked) {
      blockedRef.current = false;
      setBlocked(false);
      setVisible(false);
      setEntitlementVersion((version) => version + 1);
    }
  }, [profile]);

  const openPaywall = useCallback((next?: PaywallTrigger) => {
    if (next) setTrigger(next);
    setVisible(true);
  }, []);

  const closePaywall = useCallback(() => setVisible(false), []);

  const handleSubscribed = useCallback(async () => {
    blockedRef.current = false;
    setBlocked(false);
    setVisible(false);
    setTrigger(null);
    setEntitlementVersion((version) => version + 1);
    await refreshProfile();
  }, [refreshProfile]);

  const value = useMemo<PaywallContextValue>(
    () => ({ visible, blocked, trigger, entitlementVersion, openPaywall, closePaywall }),
    [visible, blocked, trigger, entitlementVersion, openPaywall, closePaywall],
  );

  return (
    <PaywallContext.Provider value={value}>
      {children}
      <PaywallModal visible={visible} trigger={trigger} onClose={closePaywall} onSubscribed={handleSubscribed} />
    </PaywallContext.Provider>
  );
}

export function usePaywall(): PaywallContextValue {
  const context = useContext(PaywallContext);
  if (!context) throw new Error('usePaywall must be used inside <PaywallProvider>');
  return context;
}
