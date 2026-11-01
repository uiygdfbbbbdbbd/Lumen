import { useState } from 'react';
import { Link, Outlet, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { Avatar, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, cn } from '@lumen/ui';
import { Home, LogOut, Menu, Palette, Settings, Shield, ShieldCheck, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { hasPermission, useLogout, useMe, useSetMe, type MeResponse } from '../../lib/auth.js';
import { Logo } from '../auth/AuthLayout.js';
import { CoachMarks } from './CoachMarks.js';
import { VerifyBanner } from './VerifyBanner.js';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  tour?: string;
}

export function AppShell() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useSearch({ strict: false }) as { tour?: string };
  const [drawer, setDrawer] = useState(false);
  const [touring, setTouring] = useState(search.tour === '1' && me?.user.onboarding.tourCompleted === false);
  if (!me) return null;

  const nav: NavItem[] = [
    { to: '/', label: 'Home', icon: <Home size={18} />, tour: 'home' },
    { to: '/settings/appearance', label: 'Themes', icon: <Palette size={18} />, tour: 'themes' },
    { to: '/settings/account', label: 'Settings', icon: <Settings size={18} />, tour: 'settings' },
    ...(hasPermission(me, 'admin:access') ? [{ to: '/admin', label: 'Admin', icon: <ShieldCheck size={18} /> }] : []),
  ];

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 p-3">
      <Link to="/" className="mb-4 flex items-center gap-2 px-2 font-semibold text-fg" onClick={() => setDrawer(false)}>
        <Logo size={24} /> Lumen
      </Link>
      {nav.map((n) => {
        const active = n.to === '/' ? path === '/' : path.startsWith(n.to);
        return (
          <Link key={n.to} to={n.to} data-tour={n.tour} onClick={() => setDrawer(false)} aria-current={active ? 'page' : undefined} className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm', active ? 'bg-accent-soft font-medium text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg')}>
            <span aria-hidden="true">{n.icon}</span>
            {n.label}
          </Link>
        );
      })}
      <div className="mt-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-tour="account" className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-hover">
              <Avatar src={me.user.avatarUrl} name={me.user.displayName} seed={me.user.id} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{me.user.displayName}</span>
                <span className="block truncate text-xs text-fg-3">{me.user.email}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuLabel>{me.user.email}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => navigate({ to: '/settings/account' })}><Settings size={16} aria-hidden="true" /> Settings</DropdownMenuItem>
            {hasPermission(me, 'admin:access') ? <DropdownMenuItem onSelect={() => navigate({ to: '/design-system' })}><Shield size={16} aria-hidden="true" /> Design system</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => logout.mutate(undefined, { onSettled: () => navigate({ to: '/login' }) })}><LogOut size={16} aria-hidden="true" /> Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-elevated focus:px-3 focus:py-2">Skip to content</a>
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface md:block">{sidebar}</aside>
      {drawer ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-lg">
            <div className="absolute right-2 top-2"><IconButton label="Close menu" icon={<X size={18} />} onClick={() => setDrawer(false)} /></div>
            {sidebar}
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          <IconButton label="Open menu" icon={<Menu size={18} />} onClick={() => setDrawer(true)} />
          <span className="font-semibold">Lumen</span>
        </header>
        <VerifyBanner />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      {touring ? (
        <CoachMarks
          steps={[
            { target: 'home', title: 'Your home', body: 'Start chats here. Suggestions are tailored to what you told us you’ll use it for.' },
            { target: 'themes', title: 'Make it yours', body: 'Switch themes, build your own, or browse community themes.' },
            { target: 'settings', title: 'Settings', body: 'Security, sessions, 2FA, privacy and data export all live here.' },
            { target: 'account', title: 'Your account', body: 'Sign out or jump to settings from here.' },
          ]}
          onDone={() => {
            setTouring(false);
            void api<MeResponse>('/api/me/onboarding', { method: 'PATCH', body: { tourCompleted: true } }).then(setMe);
            void navigate({ to: path, search: {} as never, replace: true });
          }}
        />
      ) : null}
    </div>
  );
}
