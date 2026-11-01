import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { signupSchema } from '@lumen/shared';
import { Banner, Button, Checkbox, Field, Input, Label, PasswordStrength } from '@lumen/ui';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { usePublicConfig, useSetMe, type MeResponse } from '../../lib/auth.js';
import { t } from '../../lib/i18n.js';
import { AvatarPicker, uploadAvatar, type AvatarSelection } from './AvatarPicker.js';
import { usePasswordStrength } from './usePasswordStrength.js';

export function SignupPage() {
  const navigate = useNavigate();
  const setMe = useSetMe();
  const { data: cfg } = usePublicConfig();
  const [form, setForm] = useState({ displayName: '', email: '', password: '', inviteCode: '', birthYear: '', acceptTerms: false });
  const [avatar, setAvatar] = useState<AvatarSelection | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = usePasswordStrength(form.password, [form.email, form.displayName]);
  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (cfg?.signup.mode === 'closed') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Sign-ups are closed</h1>
        <p className="text-sm text-fg-2">This instance isn’t accepting new accounts right now.</p>
        <Link to="/login" className="text-sm text-accent underline underline-offset-2">Back to sign in</Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      email: form.email,
      password: form.password,
      displayName: form.displayName,
      acceptTerms: form.acceptTerms,
      ...(form.inviteCode ? { inviteCode: form.inviteCode } : {}),
      ...(form.birthYear ? { birthYear: Number(form.birthYear) } : {}),
    };
    const local = signupSchema.safeParse(payload);
    if (!local.success) {
      const errs: Record<string, string> = {};
      for (const i of local.error.issues) errs[i.path.join('.')] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      let me = await api<MeResponse>('/api/auth/signup', { method: 'POST', body: local.data });
      if (avatar) {
        try {
          me = (await uploadAvatar(avatar, api)) as MeResponse;
        } catch {
          // Non-fatal: the user can add a photo in onboarding.
        }
      }
      setMe(me);
      await navigate({ to: '/onboarding' });
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold text-fg">{t('auth.signUp')}</h1>
        <p className="text-sm text-fg-2">Free forever. No credit card.</p>
      </div>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <AvatarPicker name={form.displayName} value={avatar} onChange={setAvatar} />
      <Field label="Display name" error={errors.displayName}>
        <Input autoComplete="name" value={form.displayName} onChange={update('displayName')} required />
      </Field>
      <Field label={t('auth.email')} error={errors.email}>
        <Input type="email" autoComplete="email" value={form.email} onChange={update('email')} required />
      </Field>
      <Field label={t('auth.password')} error={errors.password} hint="At least 10 characters. A few random words works well.">
        <Input type="password" autoComplete="new-password" value={form.password} onChange={update('password')} required />
      </Field>
      <PasswordStrength score={strength?.score ?? null} warning={strength?.warning} />
      {cfg?.signup.mode === 'invite' ? (
        <Field label="Invite code" error={errors.inviteCode}>
          <Input value={form.inviteCode} onChange={update('inviteCode')} required />
        </Field>
      ) : null}
      {cfg && cfg.signup.minimumAge > 0 ? (
        <Field label="Birth year" error={errors.birthYear} hint={`You must be at least ${cfg.signup.minimumAge} to use this service.`}>
          <Input inputMode="numeric" maxLength={4} value={form.birthYear} onChange={update('birthYear')} required />
        </Field>
      ) : null}
      <div className="flex items-start gap-2">
        <Checkbox id="terms" checked={form.acceptTerms} onCheckedChange={(v) => setForm((f) => ({ ...f, acceptTerms: v === true }))} aria-invalid={errors.acceptTerms ? true : undefined} />
        <Label htmlFor="terms" className="font-normal text-fg-2">
          I agree to the <a className="text-accent underline" href={cfg?.branding.tosUrl ?? '/legal/terms'} target="_blank" rel="noreferrer">Terms</a> and{' '}
          <a className="text-accent underline" href={cfg?.branding.privacyUrl ?? '/legal/privacy'} target="_blank" rel="noreferrer">Privacy Policy</a>.
        </Label>
      </div>
      {errors.acceptTerms ? <p role="alert" className="-mt-2 text-xs text-danger">{errors.acceptTerms}</p> : null}
      <Button type="submit" size="lg" loading={busy}>
        {t('auth.signUp')}
      </Button>
      <p className="text-center text-sm text-fg-2">
        Already have an account? <Link to="/login" className="text-accent underline underline-offset-2">{t('auth.signIn')}</Link>
      </p>
    </form>
  );
}
