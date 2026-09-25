import { getApp, getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';
import { config } from '../config';

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(config.firebase);
export const auth = getAuth(firebaseApp);

setPersistence(auth, browserLocalPersistence).catch((error: unknown) => {
  console.warn('Could not enable persistent admin sessions', error);
});
