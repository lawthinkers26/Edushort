import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** True while the app is in the foreground. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      setActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  return active;
}
