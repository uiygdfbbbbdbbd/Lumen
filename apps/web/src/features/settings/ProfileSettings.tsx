import { useState } from 'react';
import { Button, Card, CardHeader, Field, Input, Select, Textarea, toast } from '@lumen/ui';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useMe, useSetMe, type MeResponse } from '../../lib/auth.js';
import { AvatarPicker, uploadAvatar, type AvatarSelection } from '../auth/AvatarPicker.js';

const TIMEZONES: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];
const LOCALES = [
  ['en', 'English'],
  ['en-GB', 'English (UK)'],
  ['nl', 'Nederlands'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['pt-BR', 'Português (Brasil)'],
  ['ja', '日本語'],
] as const;

export function ProfileSettings() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const u = me!.user;
  const [form, setForm] = useState({ displayName: u.displayName, bio: u.bio, timezone: u.timezone, locale: u.locale, pronouns: u.pronouns ?? '' });
  const [avatar, setAvatar] = useState<AvatarSelection | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      let res = await api<MeResponse>('/api/me/profile', { method: 'PATCH', body: { ...form, pronouns: form.pronouns || null } });
      if (avatar) res = (await uploadAvatar(avatar, api)) as MeResponse;
      setMe(res);
      setAvatar(null);
      toast.success('Profile saved');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not save profile', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Profile" description="How you appear to collaborators." />
      <form onSubmit={save} className="flex flex-col gap-4">
        <AvatarPicker
          name={form.displayName}
          currentUrl={u.avatarUrl}
          value={avatar}
          onChange={setAvatar}
          onRemove={() => {
            if (u.avatarUrl) void api<MeResponse>('/api/me/avatar', { method: 'DELETE' }).then(setMe);
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" error={errors.displayName}>
            <Input value={form.displayName} maxLength={80} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="Pronouns" optional error={errors.pronouns}>
            <Input value={form.pronouns} maxLength={40} placeholder="e.g. they/them" onChange={(e) => setForm({ ...form, pronouns: e.target.value })} />
          </Field>
        </div>
        <Field label="Bio" optional error={errors.bio} hint={`${form.bio.length}/500`}>
          <Textarea value={form.bio} maxLength={500} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Time zone" error={errors.timezone}>
            <Select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </Select>
          </Field>
          <Field label="Language" error={errors.locale}>
            <Select value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}>
              {LOCALES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>Save changes</Button>
        </div>
      </form>
    </Card>
  );
}
