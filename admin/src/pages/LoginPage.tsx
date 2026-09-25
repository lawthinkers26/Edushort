import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Spinner } from '../components/Spinner';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { status, signIn, signOut, recheckClaims, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'admin') return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-slate-900 to-slate-950 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">▶</div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">EduShorts Admin</h1>
            <p className="text-xs text-slate-500">Restricted to administrators</p>
          </div>
        </div>

        {status === 'notAdmin' ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <strong>{user?.email}</strong> is signed in but does not have admin access. Ask an owner to run{' '}
              <code className="rounded bg-amber-100 px-1">npm run set-admin -- {user?.email}</code>, then refresh.
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-primary flex-1" onClick={() => void recheckClaims()}>
                Re-check access
              </button>
              <button type="button" className="btn-secondary" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button type="submit" className="btn-primary w-full" disabled={submitting || status === 'loading'}>
              {submitting ? <Spinner className="h-4 w-4" /> : null}
              Sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
