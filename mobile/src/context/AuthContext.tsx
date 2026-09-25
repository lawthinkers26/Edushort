import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile as updateFirebaseProfile,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { describeError } from '../api/client';
import { fetchProfile, updateProfile } from '../api/profile';
import { auth } from '../lib/firebase';
import type { Profile } from '../types/api';

interface AuthContextValue {
  user: User | null;
  initializing: boolean;
  profile: Profile | null;
  profileLoading: boolean;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Human-friendly Firebase Auth errors. */
export function describeAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/invalid-email':
        return 'That email address looks invalid.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password.';
      case 'auth/email-already-in-use':
        return 'An account with this email already exists. Try signing in.';
      case 'auth/weak-password':
        return 'Choose a stronger password (at least 6 characters).';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'auth/network-request-failed':
        return 'No internet connection.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      default:
        return error.message;
    }
  }
  return describeError(error);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [initializing, setInitializing] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const refreshProfile = useCallback(async (): Promise<Profile | null> => {
    if (!auth.currentUser) {
      setProfile(null);
      return null;
    }
    setProfileLoading(true);
    try {
      const next = await fetchProfile();
      setProfile(next);
      setProfileError(null);
      return next;
    } catch (error) {
      setProfileError(describeError(error));
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setInitializing(false);
      if (nextUser) {
        void refreshProfile();
      } else {
        setProfile(null);
        setProfileError(null);
      }
    });
    return unsubscribe;
  }, [refreshProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      throw new Error(describeAuthError(error));
    }
  }, []);

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      try {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const displayName = name.trim();
        if (displayName) {
          await updateFirebaseProfile(credential.user, { displayName });
          // Force a fresh token so the `name` claim is present, then sync the profile row.
          await credential.user.getIdToken(true);
          try {
            setProfile(await updateProfile(displayName));
          } catch (error) {
            console.warn('Profile name sync failed', error);
          }
        }
      } catch (error) {
        throw new Error(describeAuthError(error));
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      throw new Error(describeAuthError(error));
    }
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (error) {
      throw new Error(describeAuthError(error));
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      profile,
      profileLoading,
      profileError,
      signIn,
      signUp,
      signOut,
      resetPassword,
      refreshProfile,
    }),
    [user, initializing, profile, profileLoading, profileError, signIn, signUp, signOut, resetPassword, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
