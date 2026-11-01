import { useState } from 'react';
import { Banner, Button } from '@lumen/ui';
import { api, errorMessage } from '../../lib/api.js';
import { useMe } from '../../lib/auth.js';
import { t } from '../../lib/i18n.js';

const KEY = 'lumen.verifyBanner.dismissedUntil';

/** Persistent but dismissible for 24 hours. */
export function VerifyBanner() {
  const { data: me } = useMe();
  const [hidden, setHidden] = useState(() => Number(localStorage.getItem(KEY) ?? 0) > Date.now());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me || me.user.emailVerified || me.user.role !== 'user' || hidden) return null;
  return (
    <Banner
      tone="warning"
      title={t('verify.banner.title')}
      onDismiss={() => {
        localStorage.setItem(KEY, String(Date.now() + 86400_000));
        setHidden(true);
      }}
      action={
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api('/api/auth/resend-verification', { method: 'POST' });
              setMsg(`Sent! Check ${me.user.email}.`);
            } catch (e) {
              setMsg(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('verify.resend')}
        </Button>
      }
      className="rounded-none border-x-0 border-t-0"
    >
      {msg ?? t('verify.banner.body', { email: me.user.email })}
    </Banner>
  );
}
