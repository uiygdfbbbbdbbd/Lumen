import { useMemo } from 'react';
import { Card } from '@lumen/ui';
import { useMe } from '../../lib/auth.js';
import { greetingKey, t } from '../../lib/i18n.js';
import { startersFor } from './starters.js';

export function HomePage() {
  const { data: me } = useMe();
  const starters = useMemo(() => startersFor(me?.user.onboarding.useCases ?? []), [me?.user.onboarding.useCases]);
  if (!me) return null;
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: me.user.timezone }).format(new Date()));
  const first = me.user.displayName.split(' ')[0] ?? me.user.displayName;
  return (
    <div className="mx-auto flex w-full max-w-[var(--lm-chat-width)] flex-col gap-8 px-4 py-12">
      <h1 className="text-center text-3xl font-semibold tracking-tight text-fg">{t(greetingKey(hour), { name: first })}</h1>
      <section aria-label="Suggested prompts" className="grid gap-3 sm:grid-cols-2">
        {starters.map((s) => (
          <Card key={s.title} className="p-4">
            <h2 className="text-sm font-medium text-fg">{s.title}</h2>
            <p className="mt-1 line-clamp-2 text-xs text-fg-2">{s.prompt}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
