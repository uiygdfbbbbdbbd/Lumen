import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LumenError } from '@lumen/shared';
import { Banner, Button, Field, Input, PasswordStrength, Spinner } from '@lumen/ui';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { ME_KEY, useSetMe, type MeResponse } from '../../lib/auth.js';
import { usePasswordStrength } from './usePasswordStrength.js';

type Status = { state: 'working' } | { state: 'ok'; message: string } | { state: 'expired'; message: string } | { state: 'error'; message: string };

function useToken(): string {
  const s = useSearch({ strict: false }) as { token?: string };
  return typeof s.token === 'string' ? s.token : '';
}

/** Runs a token consumer exactly once (StrictMode double-mount safe). */
function useConsume(run: () => Promise<string>): Status {
  const [status, setStatus] = useState<Status>({ state: 'working' });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run()
      .then((message) => setStatus({ state: 'ok', message }))
      .catch((err) =>
        setStatus(err instanceof LumenError && err.code === 'TOKEN_EXPIRED' ? { state: 'expired', message: err.message } : { state: 'error', message: errorMessage(err) }),
      );
  }, [run]);
  return status;
}

function StatusView({ status, title, children }: { status: Status; title: string; children?: React.ReactNode }) {
  const icon =
    status.state === 'working' ? <Spinner size={28} /> : status.state === 'ok' ? <CheckCircle2 size={32} className="text-success" aria-hidden="true" /> : status.state === 'expired' ? <Clock size={32} className="text-warning" aria-hidden="true" /> : <XCircle size={32} className="text-danger" aria-hidden="true" />;
  return (
    <div className="flex flex-col items-center gap-3 text-center" aria-live="polite">
      {icon}
      <h1 className="text-xl font-semibold">{status.state === 'working' ? title : status.state === 'ok' ? 'All set' : status.state === 'expired' ? 'Link expired' : 'Link not valid'}</h1>
      {status.state !== 'working' ? <p className="text-sm text-fg-2">{status.message}</p> : null}
      {children}
    </div>
  );
}

export function VerifyEmailPage() {
  const token = useToken();
  const qc = useQueryClient();
  const [resent, setResent] = useState<string | null>(null);
  const status = useConsume(async () => {
    if (!token) throw new LumenError('INVALID_TOKEN', 'This verification link is incomplete.');
    const r = await api<{ email: string }>('/api/auth/verify-email', { method: 'POST', body: { token } });
    await qc.invalidateQueries({ queryKey: ME_KEY });
    return `${r.email} is verified. All features are unlocked.`;
  });
  const me = qc.getQueryData<MeResponse | null>(ME_KEY);
  return (
    <StatusView status={status} title="Verifying your email…">
      {status.state === 'ok' ? (
        <Button asChild><Link to="/">Continue</Link></Button>
      ) : status.state !== 'working' ? (
        <div className="flex flex-col items-center gap-2">
          {me ? (
            <Button
              variant="secondary"
              onClick={() =>
                api('/api/auth/resend-verification', { method: 'POST' })
                  .then(() => setResent('A new link is on its way.'))
                  .catch((e) => setResent(errorMessage(e)))
              }
            >
              Send a new link
            </Button>
          ) : (
            <Link to="/login" className="text-sm text-accent underline underline-offset-2">Sign in to request a new link</Link>
          )}
          {resent ? <p className="text-sm text-fg-2" role="status">{resent}</p> : null}
        </div>
      ) : null}
    </StatusView>
  );
}

export function ConfirmEmailChangePage() {
  const token = useToken();
  const qc = useQueryClient();
  const status = useConsume(async () => {
    const r = await api<{ email: string }>('/api/auth/confirm-email-change', { method: 'POST', body: { token } });
    await qc.invalidateQueries({ queryKey: ME_KEY });
    return `Your email is now ${r.email}.`;
  });
  return (
    <StatusView status={status} title="Confirming your new email…">
      {status.state !== 'working' ? <Link to="/settings/account" className="text-sm text-accent underline underline-offset-2">Go to account settings</Link> : null}
    </StatusView>
  );
}

export function MagicLinkPage() {
  const token = useToken();
  const setMe = useSetMe();
  const navigate = useNavigate();
  const status = useConsume(async () => {
    const me = await api<MeResponse>('/api/auth/magic-link/consume', { method: 'POST', body: { token } });
    setMe(me);
    setTimeout(() => void navigate({ to: me.user.onboarding.completed ? '/' : '/onboarding' }), 600);
    return 'Signed in. Redirecting…';
  });
  return (
    <StatusView status={status} title="Signing you in…">
      {status.state === 'error' || status.state === 'expired' ? <Link to="/login" className="text-sm text-accent underline underline-offset-2">Back to sign in</Link> : null}
    </StatusView>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
          setSent(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">Reset your password</h1>
        <p className="text-sm text-fg-2">We’ll email you a link to choose a new one.</p>
      </div>
      {sent ? <Banner tone="success">If an account exists for {email}, a reset link is on its way. Check your inbox.</Banner> : null}
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <Field label="Email">
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </Field>
      <Button type="submit" loading={busy} size="lg">Send reset link</Button>
      <Link to="/login" className="text-center text-sm text-accent underline underline-offset-2">Back to sign in</Link>
    </form>
  );
}

export function ResetPasswordPage() {
  const token = useToken();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = usePasswordStrength(password, []);
  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle2 size={32} className="text-success" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Password updated</h1>
        <p className="text-sm text-fg-2">For safety, we signed you out on all devices.</p>
        <Button asChild><Link to="/login">Sign in</Link></Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api('/api/auth/reset-password', { method: 'POST', body: { token, password } });
          setDone(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      {!token ? <Banner tone="critical">This reset link is incomplete. Request a new one.</Banner> : null}
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <Field label="New password" hint="At least 10 characters.">
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      </Field>
      <PasswordStrength score={strength?.score ?? null} warning={strength?.warning} />
      <Button type="submit" size="lg" loading={busy} disabled={!token}>Update password</Button>
      <Link to="/forgot-password" className="text-center text-sm text-accent underline underline-offset-2">Request a new link</Link>
    </form>
  );
}
