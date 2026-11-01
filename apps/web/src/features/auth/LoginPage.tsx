import { useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { LumenError } from '@lumen/shared';
import { Banner, Button, Field, Input } from '@lumen/ui';
import { api, errorMessage } from '../../lib/api.js';
import { usePublicConfig, useSetMe, type MeResponse } from '../../lib/auth.js';
import { t } from '../../lib/i18n.js';

export function LoginPage() {
  const search = useSearch({ strict: false }) as { redirect?: string };
  const navigate = useNavigate();
  const setMe = useSetMe();
  const { data: cfg } = usePublicConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { email, password };
      if (needs2fa && code) body[useRecovery ? 'recoveryCode' : 'totpCode'] = code.trim();
      const me = await api<MeResponse>('/api/auth/login', { method: 'POST', body });
      setMe(me);
      const target = search.redirect && search.redirect.startsWith('/') && !search.redirect.startsWith('//') ? search.redirect : '/';
      await navigate({ to: me.user.onboarding.completed ? target : '/onboarding' });
    } catch (err) {
      if (err instanceof LumenError && err.code === 'TWO_FACTOR_REQUIRED') {
        setNeeds2fa(true);
        setError(null);
      } else if (err instanceof LumenError && err.code === 'ACCOUNT_LOCKED' && err.resetAt) {
        setError(`Too many attempts. Try again ${new Date(err.resetAt).toLocaleTimeString()}.`);
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendMagic() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/magic-link/request', { method: 'POST', body: { email } });
      setMagicSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold text-fg">{t('auth.signIn')}</h1>
        <p className="text-sm text-fg-2">Welcome back.</p>
      </div>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      {magicSent ? <Banner tone="success">If an account exists for {email}, a sign-in link is on its way.</Banner> : null}
      <Field label={t('auth.email')}>
        <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </Field>
      <Field label={t('auth.password')}>
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {needs2fa ? (
        <Field label={useRecovery ? 'Recovery code' : 'Authentication code'} hint={useRecovery ? 'One of the codes you saved when enabling 2FA.' : 'The 6-digit code from your authenticator app.'}>
          <Input
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            maxLength={useRecovery ? 16 : 6}
          />
        </Field>
      ) : null}
      {needs2fa ? (
        <button type="button" className="self-start text-sm text-accent hover:underline" onClick={() => setUseRecovery((v) => !v)}>
          {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code'}
        </button>
      ) : null}
      <Button type="submit" loading={busy} size="lg">
        {t('auth.signIn')}
      </Button>
      {cfg?.auth.magicLink ? (
        <Button type="button" variant="secondary" disabled={!email || busy} onClick={sendMagic}>
          Email me a sign-in link
        </Button>
      ) : null}
      <div className="flex justify-between text-sm">
        <Link to="/forgot-password" className="text-accent underline underline-offset-2">
          {t('auth.forgot')}
        </Link>
        {cfg?.signup.mode !== 'closed' ? (
          <Link to="/signup" className="text-accent underline underline-offset-2">
            {t('auth.signUp')}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
