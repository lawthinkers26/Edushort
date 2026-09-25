import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import type { Auth, Persistence } from 'firebase/auth';
import { config } from '../config/env';

/**
 * `getReactNativePersistence` ships in firebase/auth's react-native bundle
 * (which Metro resolves), but the package's public typings omit it.
 */
type ReactNativePersistenceFactory = (storage: typeof AsyncStorage) => Persistence;
const { getReactNativePersistence } = FirebaseAuth as unknown as {
  getReactNativePersistence: ReactNativePersistenceFactory;
};

export const firebaseApp: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(config.firebase);

function createAuth(): Auth {
  try {
    // Persist the session across app restarts.
    return FirebaseAuth.initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Fast Refresh re-evaluates this module; auth is already initialised then.
    return FirebaseAuth.getAuth(firebaseApp);
  }
}

export const auth: Auth = createAuth();
