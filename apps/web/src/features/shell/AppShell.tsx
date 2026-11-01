import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { Avatar, Banner, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, Kbd, cn } from '@lumen/ui';
import { Archive, Download, EyeOff, FolderKanban, FolderOpen, Keyboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Palette, Plus, Search, Settings, Shield, ShieldCheck, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { hasPermission, useLogout, useMe, useSetMe, type MeResponse } from '../../lib/auth.js';
import { formatCombo, resolveBindings, useShortcuts } from '../../lib/shortcuts.js';
import { useThemeStore } from '../../lib/theme.js';
import { useInstallPrompt } from '../../lib/pwa.js';
import { Logo } from '../auth/AuthLayout.js';
import { ConversationList } from '../chat/ConversationList.js';
import { useRealtime } from '../chat/useRealtime.js';
import { usePreferences } from '../models/useModels.js';
import { CoachMarks } from './CoachMarks.js';
import { CommandPalette } from './CommandPalette.js';
import { ShortcutsHelp } from './ShortcutsHelp.js';
import { VerifyBanner } from './VerifyBanner.js';

const SIDEBAR_KEY = 'lumen.sidebar';

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function AppShell() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const { data: prefs } = usePreferences();
  const theme = useThemeStore();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useSearch({ strict: false }) as { tour?: string };
  const online = useOnline();
  const saved = JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? '{"open":true,"width":272}') as { open: boolean; width: number };
  const [sidebarOpen, setSidebarOpen] = useState(saved.open);
  const [width, setWidth] = useState(saved.width);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [touring, setTouring] = useState(search.tour === '1' && me?.user.onboarding.tourCompleted === false);
  const bindings = resolveBindings(prefs?.shortcuts);
  const install = useInstallPrompt();
  useRealtime(Boolean(me));

  useEffect(() => localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ open: sidebarOpen, width })), [sidebarOpen, width]);

  useShortcuts(bindings, {
    palette: () => setPalette((p) => !p),
    newChat: () => void navigate({ to: '/' }),
    temporaryChat: () => void navigate({ to: '/temporary' }),
    toggleSidebar: () => setSidebarOpen((o) => !o),
    focusComposer: () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus(),
    settings: () => void navigate({ to: '/settings/account' }),
    toggleTheme: () => theme.set({ mode: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }),
    help: () => setHelp(true),
  });

  if (!me) return null;
  const closeDrawer = () => setDrawer(false);

  const startResize = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(Math.max(220, Math.min(480, startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between px-1">
        <Link to="/" className="flex items-center gap-2 font-semibold text-fg" onClick={closeDrawer}>
          <Logo size={24} /> Lumen
        </Link>
        <IconButton className="hidden md:inline-flex" label="Collapse sidebar" icon={<PanelLeftClose size={18} />} onClick={() => setSidebarOpen(false)} />
      </div>
      <div className="flex flex-col gap-1">
        <Button variant="secondary" className="justify-start" data-tour="home" onClick={() => { closeDrawer(); void navigate({ to: '/' }); }}>
          <Plus size={16} aria-hidden="true" /> New chat <Kbd className="ml-auto">{formatCombo(bindings.newChat)}</Kbd>
        </Button>
        <Button variant="ghost" className="justify-start" onClick={() => setPalette(true)}>
          <Search size={16} aria-hidden="true" /> Search <Kbd className="ml-auto">{formatCombo(bindings.palette)}</Kbd>
        </Button>
        <Button variant="ghost" className="justify-start" onClick={() => { closeDrawer(); void navigate({ to: '/temporary' }); }}>
          <EyeOff size={16} aria-hidden="true" /> Temporary chat
        </Button>
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-semibold text-fg-2">{showArchived ? 'Archived' : 'Chats'}</span>
          <button type="button" className="flex items-center gap-1 text-xs text-fg-2 hover:text-fg" onClick={() => setShowArchived((v) => !v)} aria-pressed={showArchived}>
            <Archive size={12} aria-hidden="true" /> {showArchived ? 'Back to chats' : 'Archive'}
          </button>
        </div>
        <ConversationList archived={showArchived} onNavigate={closeDrawer} />
      </div>
      <div className="flex flex-col gap-1 border-t border-border pt-2">
        <Link to="/projects" onClick={closeDrawer} className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm', path.startsWith('/projects') ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-hover')}><FolderKanban size={16} aria-hidden="true" /> Projects</Link>
        <Link to="/files" onClick={closeDrawer} className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm', path.startsWith('/files') ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-hover')}><FolderOpen size={16} aria-hidden="true" /> Files</Link>
        <Link to="/settings/appearance" data-tour="themes" onClick={closeDrawer} className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm', path.startsWith('/settings/appearance') ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-hover')}><Palette size={16} aria-hidden="true" /> Themes</Link>
        <Link to="/settings/account" data-tour="settings" onClick={closeDrawer} className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm', path.startsWith('/settings') && !path.startsWith('/settings/appearance') ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-hover')}><Settings size={16} aria-hidden="true" /> Settings</Link>
        {hasPermission(me, 'admin:access') ? <Link to="/admin" onClick={closeDrawer} className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm', path.startsWith('/admin') ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-hover')}><ShieldCheck size={16} aria-hidden="true" /> Admin</Link> : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-tour="account" className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-hover">
              <Avatar src={me.user.avatarUrl} name={me.user.displayName} seed={me.user.id} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{me.user.displayName}</span>
                <span className="block truncate text-xs text-fg-2">{me.user.email}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuLabel>{me.user.email}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => navigate({ to: '/settings/account' })}><Settings size={16} aria-hidden="true" /> Settings</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setHelp(true)}><Keyboard size={16} aria-hidden="true" /> Keyboard shortcuts</DropdownMenuItem>
            {install ? <DropdownMenuItem onSelect={() => void install()}><Download size={16} aria-hidden="true" /> Install app</DropdownMenuItem> : null}
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
      {sidebarOpen ? (
        <aside className="relative hidden shrink-0 border-r border-border bg-surface md:block" style={{ width }}>
          {sidebar}
          <div role="separator" aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin={220} aria-valuemax={480} aria-valuenow={width} tabIndex={0} onPointerDown={startResize} onKeyDown={(e) => { if (e.key === 'ArrowLeft') setWidth((w) => Math.max(220, w - 16)); if (e.key === 'ArrowRight') setWidth((w) => Math.min(480, w + 16)); }} className="absolute inset-y-0 -right-1 w-2 cursor-col-resize hover:bg-accent/30 focus:bg-accent/30" />
        </aside>
      ) : null}
      {drawer ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={closeDrawer} />
          <aside className="absolute inset-y-0 left-0 w-80 max-w-[85vw] bg-surface shadow-lg">
            <div className="absolute right-2 top-2"><IconButton label="Close menu" icon={<X size={18} />} onClick={closeDrawer} /></div>
            {sidebar}
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          <IconButton label="Open menu" icon={<Menu size={18} />} onClick={() => setDrawer(true)} />
          <span className="font-semibold">Lumen</span>
          <IconButton className="ml-auto" label="New chat" icon={<Plus size={18} />} onClick={() => navigate({ to: '/' })} />
        </header>
        {!sidebarOpen ? (
          <div className="absolute left-2 top-2 z-10 hidden md:block">
            <IconButton label="Expand sidebar" icon={<PanelLeftOpen size={18} />} onClick={() => setSidebarOpen(true)} />
          </div>
        ) : null}
        {!online ? <Banner tone="warning" className="rounded-none border-x-0 border-t-0" title="You’re offline">Messages you send will be queued and delivered when you reconnect.</Banner> : null}
        <VerifyBanner />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      <ShortcutsHelp open={help} onOpenChange={setHelp} bindings={bindings} />
      {touring ? (
        <CoachMarks
          steps={[
            { target: 'home', title: 'Start a chat', body: 'Start a new chat any time. Suggestions are tailored to what you told us you’ll use it for.' },
            { target: 'themes', title: 'Make it yours', body: 'Switch themes or build your own.' },
            { target: 'settings', title: 'Settings', body: 'Security, sessions, 2FA, privacy, shortcuts and data export all live here.' },
            { target: 'account', title: 'Your account', body: 'Sign out, see keyboard shortcuts, or jump to settings.' },
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
