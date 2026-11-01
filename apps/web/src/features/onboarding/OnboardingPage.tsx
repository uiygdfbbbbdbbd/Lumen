import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { USE_CASES, type OnboardingState, type UseCase } from '@lumen/shared';
import { Banner, Button, Field, Input, SwitchRow, cn } from '@lumen/ui';
import { BookOpen, Briefcase, Code2, Feather, GraduationCap, Palette, Sparkles, Search, Check } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { useMe, useSetMe, type MeResponse } from '../../lib/auth.js';
import { ALL_BUILTIN_THEMES, useThemeStore, type ThemeMode } from '../../lib/theme.js';
import { AvatarPicker, uploadAvatar, type AvatarSelection } from '../auth/AvatarPicker.js';
import { Logo } from '../auth/AuthLayout.js';
import { ThemeSwatch } from '../settings/ThemeSwatch.js';

const STEPS = ['Welcome', 'Profile', 'Theme', 'Interests', 'Model', 'Notifications', 'Tour'] as const;

const USE_CASE_META: Record<UseCase, { label: string; icon: React.ReactNode }> = {
  coding: { label: 'Coding', icon: <Code2 size={18} /> },
  writing: { label: 'Writing', icon: <Feather size={18} /> },
  research: { label: 'Research', icon: <Search size={18} /> },
  learning: { label: 'Learning', icon: <GraduationCap size={18} /> },
  business: { label: 'Business', icon: <Briefcase size={18} /> },
  creative: { label: 'Creative', icon: <Palette size={18} /> },
  other: { label: 'Something else', icon: <BookOpen size={18} /> },
};

interface ModelSummary {
  id: string;
  displayName: string;
  description: string | null;
  providerName: string;
  available: boolean;
}

export function OnboardingPage() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const navigate = useNavigate();
  const theme = useThemeStore();
  const ob = me?.user.onboarding;
  const [step, setStep] = useState(ob?.step ?? 0);
  const [name, setName] = useState(me?.user.displayName ?? '');
  const [avatar, setAvatar] = useState<AvatarSelection | null>(null);
  const [useCases, setUseCases] = useState<UseCase[]>(ob?.useCases ?? []);
  const [model, setModel] = useState(ob?.defaultModel ?? 'auto');
  const [notify, setNotify] = useState({ email: ob?.notifications?.email ?? true, push: ob?.notifications?.push ?? false, productUpdates: ob?.notifications?.productUpdates ?? false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => api<{ items: ModelSummary[] }>('/api/models').catch(() => ({ items: [] as ModelSummary[] })),
    enabled: step === 4,
  });

  // Only bounce users who arrive here after finishing; while finishing, `next()` navigates itself.
  const finishing = useRef(false);
  useEffect(() => {
    if (me?.user.onboarding.completed && !finishing.current) void navigate({ to: '/' });
  }, [me, navigate]);

  if (!me) return null;

  async function save(patch: Partial<OnboardingState>, nextStep: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<MeResponse>('/api/me/onboarding', { method: 'PATCH', body: { ...patch, step: Math.min(nextStep, 7) } });
      setMe(res);
      setStep(nextStep);
      return res;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (step === 1) {
      setBusy(true);
      try {
        if (name.trim() && name !== me!.user.displayName) setMe(await api<MeResponse>('/api/me/profile', { method: 'PATCH', body: { displayName: name.trim() } }));
        if (avatar) setMe((await uploadAvatar(avatar, api)) as MeResponse);
      } catch (err) {
        setError(errorMessage(err));
        setBusy(false);
        return;
      }
      setBusy(false);
      return save({}, 2);
    }
    if (step === 2) return save({ themeMode: theme.mode === 'time' ? 'system' : theme.mode, themeId: theme.mode === 'dark' ? theme.darkThemeId : theme.lightThemeId }, 3);
    if (step === 3) return save({ useCases }, 4);
    if (step === 4) return save({ defaultModel: model }, 5);
    if (step === 5) return save({ notifications: notify }, 6);
    if (step === 6) {
      finishing.current = true;
      const res = await save({ completed: true, tourCompleted: false }, 7);
      if (res) await navigate({ to: '/', search: { tour: '1' } as never });
      return;
    }
    return save({}, step + 1);
  }

  async function skipAll() {
    finishing.current = true;
    const res = await save({ completed: true, tourCompleted: true }, 7);
    if (res) await navigate({ to: '/' });
  }

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8">
      <div className="mb-6 flex w-full max-w-2xl items-center justify-between">
        <Logo />
        <button type="button" className="text-sm text-fg-3 hover:text-fg" onClick={skipAll}>Skip setup</button>
      </div>
      <ol className="mb-6 flex w-full max-w-2xl gap-1.5" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1" aria-current={i === step ? 'step' : undefined}>
            <div className={cn('h-1.5 rounded-full', i <= step ? 'bg-accent' : 'bg-border')} />
            <span className="sr-only">{`Step ${i + 1} of ${STEPS.length}: ${s}${i < step ? ' (done)' : ''}`}</span>
          </li>
        ))}
      </ol>
      <main id="main" className="w-full max-w-2xl rounded-lg border border-border bg-elevated p-6 shadow-md sm:p-8">
        {error ? <Banner tone="critical" className="mb-4">{error}</Banner> : null}
        {step === 0 && (
          <section className="flex flex-col items-center gap-4 py-6 text-center">
            <Sparkles size={40} className="text-accent" aria-hidden="true" />
            <h1 className="text-2xl font-semibold">Welcome, {me.user.displayName}!</h1>
            <p className="max-w-md text-fg-2">Let’s set things up in about a minute. You can change everything later in Settings.</p>
          </section>
        )}
        {step === 1 && (
          <section className="flex flex-col gap-5">
            <h1 className="text-xl font-semibold">How should we show you?</h1>
            <AvatarPicker name={name} currentUrl={me.user.avatarUrl} value={avatar} onChange={setAvatar} />
            <Field label="Display name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
          </section>
        )}
        {step === 2 && (
          <section className="flex flex-col gap-5">
            <h1 className="text-xl font-semibold">Pick a look</h1>
            <div role="radiogroup" aria-label="Color mode" className="grid grid-cols-3 gap-2">
              {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={theme.mode === m} onClick={() => theme.set({ mode: m })} className={cn('rounded-md border px-3 py-2 text-sm capitalize', theme.mode === m ? 'border-accent bg-accent-soft text-fg' : 'border-border text-fg-2 hover:bg-hover')}>
                  {m}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {ALL_BUILTIN_THEMES.slice(0, 9).map((b) => {
                const selected = b.theme.mode === 'dark' ? theme.darkThemeId === b.id : theme.lightThemeId === b.id;
                return (
                  <ThemeSwatch
                    key={b.id}
                    theme={b.theme}
                    selected={selected}
                    onSelect={() => theme.set(b.theme.mode === 'dark' ? { darkThemeId: b.id, mode: theme.mode === 'light' ? 'dark' : theme.mode } : { lightThemeId: b.id, mode: theme.mode === 'dark' ? 'light' : theme.mode })}
                  />
                );
              })}
            </div>
          </section>
        )}
        {step === 3 && (
          <section className="flex flex-col gap-5">
            <div>
              <h1 className="text-xl font-semibold">What will you use it for?</h1>
              <p className="text-sm text-fg-2">We’ll suggest prompts that fit. Pick as many as you like.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Use cases">
              {USE_CASES.map((u) => {
                const on = useCases.includes(u);
                return (
                  <button key={u} type="button" aria-pressed={on} onClick={() => setUseCases((l) => (on ? l.filter((x) => x !== u) : [...l, u]))} className={cn('flex items-center gap-2 rounded-md border px-3 py-3 text-left text-sm', on ? 'border-accent bg-accent-soft text-fg' : 'border-border text-fg-2 hover:bg-hover')}>
                    <span aria-hidden="true">{USE_CASE_META[u].icon}</span>
                    <span className="flex-1">{USE_CASE_META[u].label}</span>
                    {on ? <Check size={16} className="text-accent" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {step === 4 && (
          <section className="flex flex-col gap-4">
            <div>
              <h1 className="text-xl font-semibold">Default model</h1>
              <p className="text-sm text-fg-2">You can switch models in any chat.</p>
            </div>
            <div role="radiogroup" aria-label="Default model" className="flex flex-col gap-2">
              {[{ id: 'auto', displayName: 'Auto (recommended)', description: 'Let the instance pick the best available model.', providerName: '', available: true }, ...(models.data?.items ?? [])].map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={model === m.id} disabled={!m.available} onClick={() => setModel(m.id)} className={cn('flex flex-col items-start rounded-md border px-4 py-3 text-left disabled:opacity-50', model === m.id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-hover')}>
                  <span className="text-sm font-medium text-fg">{m.displayName}</span>
                  {m.description ? <span className="text-xs text-fg-2">{m.description}</span> : null}
                </button>
              ))}
            </div>
          </section>
        )}
        {step === 5 && (
          <section className="flex flex-col gap-2">
            <h1 className="mb-2 text-xl font-semibold">Notifications</h1>
            <SwitchRow label="Email me about finished tasks" description="Scheduled tasks, long-running agents, research reports." checked={notify.email} onCheckedChange={(v) => setNotify((n) => ({ ...n, email: v }))} />
            <SwitchRow label="Browser notifications" description="You’ll be asked for permission." checked={notify.push} onCheckedChange={async (v) => { if (v && 'Notification' in window) await Notification.requestPermission(); setNotify((n) => ({ ...n, push: v })); }} />
            <SwitchRow label="Product updates" description="Occasional news about new features." checked={notify.productUpdates} onCheckedChange={(v) => setNotify((n) => ({ ...n, productUpdates: v }))} />
          </section>
        )}
        {step === 6 && (
          <section className="flex flex-col gap-3">
            <h1 className="text-xl font-semibold">You’re ready</h1>
            <p className="text-fg-2">We’ll point out a few things on the next screen. Press <kbd className="rounded border border-border px-1">Ctrl</kbd>+<kbd className="rounded border border-border px-1">K</kbd> anytime for the command palette, or <kbd className="rounded border border-border px-1">?</kbd> for shortcuts.</p>
            {!me.user.emailVerified ? <Banner tone="info" title="One more thing">Verify your email ({me.user.email}) to unlock Code Mode, API keys and sharing.</Banner> : null}
          </section>
        )}
        <div className="mt-8 flex justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>Back</Button>
          <div className="flex gap-2">
            {step > 0 && step < 6 ? <Button variant="secondary" onClick={() => save({}, step + 1)} disabled={busy}>Skip</Button> : null}
            <Button onClick={next} loading={busy}>{step === 6 ? 'Start the tour' : step === 0 ? 'Get started' : 'Continue'}</Button>
          </div>
        </div>
      </main>
    </div>
  );
}
