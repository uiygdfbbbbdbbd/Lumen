import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Banner, Button, Card, CardHeader, ConfirmDialog, Dialog, DialogContent, Field, Input, PasswordStrength, Skeleton, toast } from '@lumen/ui';
import { Laptop, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { ME_KEY, useMe } from '../../lib/auth.js';
import { relativeTime } from '../../lib/i18n.js';
import { usePasswordStrength } from '../auth/usePasswordStrength.js';

interface SessionItem { id: string; current: boolean; device: string; ip: string | null; location: string | null; createdAt: string; lastSeenAt: string }
interface LoginItem { id: string; success: boolean; reason: string | null; method: string; device: string; ip: string | null; location: string | null; createdAt: string }

function PasswordCard() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const strength = usePasswordStrength(next, []);
  const m = useMutation({
    mutationFn: () => api('/api/me/password', { method: 'POST', body: { currentPassword: cur, newPassword: next } }),
    onSuccess: () => {
      setCur('');
      setNext('');
      toast.success('Password changed', 'Other devices were signed out.');
    },
  });
  return (
    <Card>
      <CardHeader title="Password" description="Changing it signs out your other devices." />
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error ? <Banner tone="critical">{errorMessage(m.error)}</Banner> : null}
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <PasswordStrength score={strength?.score ?? null} warning={strength?.warning} />
        <div className="flex justify-end"><Button type="submit" loading={m.isPending} disabled={!cur || !next}>Change password</Button></div>
      </form>
    </Card>
  );
}

function EmailCard() {
  const { data: me } = useMe();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const m = useMutation({
    mutationFn: () => api('/api/me/email', { method: 'POST', body: { newEmail: email, password: pw } }),
    onSuccess: () => toast.success('Check your new inbox', `We sent a confirmation link to ${email}.`),
  });
  return (
    <Card>
      <CardHeader title="Email" description={<>Currently <strong>{me?.user.email}</strong> {me?.user.emailVerified ? <Badge tone="success">verified</Badge> : <Badge tone="warning">unverified</Badge>}</>} />
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error ? <Banner tone="critical" className="sm:col-span-2">{errorMessage(m.error)}</Banner> : null}
        <Field label="New email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="secondary" loading={m.isPending} disabled={!email || !pw}>Send confirmation</Button></div>
      </form>
    </Card>
  );
}

function TwoFactorCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['2fa'], queryFn: () => api<{ enabled: boolean; recoveryCodesRemaining: number }>('/api/me/2fa') });
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['2fa'] }), qc.invalidateQueries({ queryKey: ME_KEY })]);

  const enabled = status.data?.enabled;
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><ShieldCheck size={18} aria-hidden="true" /> Two-factor authentication</span>}
        description={enabled ? `On. ${status.data?.recoveryCodesRemaining} recovery codes left.` : 'Add a second step at sign-in with an authenticator app.'}
        action={enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
      />
      {error ? <Banner tone="critical" className="mb-4">{error}</Banner> : null}
      {!enabled && !setup ? (
        <Button onClick={async () => { setError(null); try { setSetup(await api('/api/me/2fa/setup', { method: 'POST' })); } catch (e) { setError(errorMessage(e)); } }}>Set up 2FA</Button>
      ) : null}
      {setup ? (
        <form className="flex flex-col gap-4 sm:flex-row" onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const r = await api<{ recoveryCodes: string[] }>('/api/me/2fa/confirm', { method: 'POST', body: { code } });
            setCodes(r.recoveryCodes);
            setSetup(null);
            setCode('');
            await refresh();
          } catch (err) { setError(errorMessage(err)); }
        }}>
          <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={180} height={180} className="rounded-md bg-white p-2" />
          <div className="flex flex-1 flex-col gap-3">
            <p className="text-sm text-fg-2">Scan the QR code, or enter this key manually:</p>
            <code className="break-all rounded-sm bg-code-bg px-2 py-1 text-sm text-code">{setup.secret}</code>
            <Field label="6-digit code"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <div className="flex gap-2"><Button type="submit" disabled={code.length !== 6}>Turn on</Button><Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button></div>
          </div>
        </form>
      ) : null}
      {enabled ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDisabling(true)}>Turn off</Button>
        </div>
      ) : null}
      <Dialog open={disabling} onOpenChange={setDisabling}>
        <DialogContent title="Turn off two-factor authentication" description="Confirm with your password and a current code.">
          <form className="flex flex-col gap-3" onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try { await api('/api/me/2fa/disable', { method: 'POST', body: { password: pw, code } }); setDisabling(false); setPw(''); setCode(''); await refresh(); toast.success('Two-factor authentication is off'); }
            catch (err) { setError(errorMessage(err)); }
          }}>
            {error ? <Banner tone="critical">{error}</Banner> : null}
            <Field label="Password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Authentication code"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <div className="flex justify-end"><Button variant="danger" type="submit">Turn off</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(codes)} onOpenChange={(o) => !o && setCodes(null)}>
        <DialogContent title="Save your recovery codes" description="Each code works once if you lose your authenticator. They won’t be shown again.">
          <ul className="grid grid-cols-2 gap-2 rounded-md bg-code-bg p-3 font-mono text-sm text-code">{codes?.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(codes?.join('\n') ?? '').then(() => toast.success('Copied'))}>Copy</Button>
            <Button onClick={() => setCodes(null)}>I saved them</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionItem[] }>('/api/me/sessions') });
  const history = useQuery({ queryKey: ['login-history'], queryFn: () => api<{ items: LoginItem[] }>('/api/me/login-history') });
  const [confirmAll, setConfirmAll] = useState(false);
  return (
    <Card>
      <CardHeader title="Active sessions" description="Devices signed in to your account." action={<Button variant="secondary" size="sm" onClick={() => setConfirmAll(true)}>Sign out everywhere</Button>} />
      {sessions.isLoading ? <Skeleton className="h-16" /> : null}
      <ul className="divide-y divide-border">
        {sessions.data?.items.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-3">
            <Laptop size={18} className="text-fg-3" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium text-fg">{s.device} {s.current ? <Badge tone="accent">This device</Badge> : null}</div>
              <div className="text-xs text-fg-3">{[s.ip, s.location].filter(Boolean).join(' · ')} · active {relativeTime(s.lastSeenAt)}</div>
            </div>
            {!s.current ? (
              <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/me/sessions/${s.id}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['sessions'] }); toast.success('Session signed out'); }}>Sign out</Button>
            ) : null}
          </li>
        ))}
      </ul>
      <h3 className="mb-2 mt-6 text-sm font-semibold">Recent sign-in activity</h3>
      <ul className="max-h-64 divide-y divide-border overflow-y-auto text-sm">
        {history.data?.items.map((h) => (
          <li key={h.id} className="flex justify-between gap-2 py-2">
            <span className={h.success ? 'text-fg' : 'text-danger'}>{h.success ? 'Signed in' : `Failed (${h.reason ?? 'error'})`} · {h.device}</span>
            <span className="shrink-0 text-xs text-fg-3">{h.ip} · {relativeTime(h.createdAt)}</span>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={confirmAll} onOpenChange={setConfirmAll} title="Sign out everywhere?" description="Every device, including this one, will need to sign in again." confirmLabel="Sign out everywhere" destructive onConfirm={async () => { await api('/api/me/sessions/revoke-all', { method: 'POST', body: { keepCurrent: false } }); window.location.href = '/login'; }} />
    </Card>
  );
}

export function SecuritySettings() {
  return (
    <>
      <PasswordCard />
      <EmailCard />
      <TwoFactorCard />
      <SessionsCard />
    </>
  );
}
