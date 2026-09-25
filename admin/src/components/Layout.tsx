import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: '📊', end: true },
  { to: '/upload', label: 'Upload Workspace', icon: '⬆️', end: false },
  { to: '/reels', label: 'Reels Library', icon: '🎬', end: false },
  { to: '/paywall', label: 'Paywall Controller', icon: '🔐', end: false },
];

export function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">▶</div>
          <div>
            <p className="text-base font-bold text-slate-900">EduShorts</p>
            <p className="text-xs text-slate-500">Admin console</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:pb-0">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-slate-200 px-6 py-4 lg:absolute lg:inset-x-0 lg:bottom-0 lg:block">
          <p className="truncate text-sm font-medium text-slate-900">{user?.email}</p>
          <button type="button" onClick={() => void signOut()} className="mt-1 text-sm text-slate-500 hover:text-slate-900">
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
