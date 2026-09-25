import { FirebaseError } from 'firebase/app';
import { onIdTokenChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth } from '../lib/firebase';

type AdminStatus = 'loading' | 'signedOut' | 'admin' | 'notAdmin';

interface AuthContextValue {
  user: User | null;
  status: AdminStatus;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  recheckClaims: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function describeAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Try again in a few minutes.';
      case 'auth/network-request-failed':
        return 'Network error — check your connection.';
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : 'Sign-in failed';
}

async function hasAdminClaim(user: User, forceRefresh = false): Promise<boolean> {
  const token = await user.getIdTokenResult(forceRefresh);
  return token.claims.admin === true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AdminStatus>('loading');

  useEffect(
    () =>
      onIdTokenChanged(auth, async (nextUser) => {
        setUser(nextUser);
        if (!nextUser) {
          setStatus('signedOut');
          return;
        }
        try {
          setStatus((await hasAdminClaim(nextUser)) ? 'admin' : 'notAdmin');
        } catch {
          setStatus('notAdmin');
        }
      }),
    [],
  );

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      throw new Error(describeAuthError(error));
    }
  }, []);

  const signOut = useCallback(() => firebaseSignOut(auth), []);

  const recheckClaims = useCallback(async () => {
    if (!auth.currentUser) return;
    setStatus((await hasAdminClaim(auth.currentUser, true)) ? 'admin' : 'notAdmin');
  }, []);

  const value = useMemo(
    () => ({ user, status, signIn, signOut, recheckClaims }),
    [user, status, signIn, signOut, recheckClaims],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within <AuthProvider>');
  return context;
}
