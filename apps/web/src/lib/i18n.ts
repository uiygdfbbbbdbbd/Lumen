/**
 * Minimal i18n layer: message catalogs keyed by locale with {var} interpolation.
 * Components call t('key'); adding a locale = adding a catalog. English is the fallback.
 */
import { useSyncExternalStore } from 'react';

type Catalog = Record<string, string>;

const en: Catalog = {
  'greeting.morning': 'Good morning, {name}',
  'greeting.afternoon': 'Good afternoon, {name}',
  'greeting.evening': 'Good evening, {name}',
  'greeting.night': 'Working late, {name}?',
  'auth.signIn': 'Sign in',
  'auth.signUp': 'Create account',
  'auth.signOut': 'Sign out',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.forgot': 'Forgot password?',
  'verify.banner.title': 'Verify your email to unlock everything',
  'verify.banner.body': 'Code Mode, API keys, sharing, connectors and higher limits unlock once you confirm {email}.',
  'verify.resend': 'Resend email',
  'common.save': 'Save changes',
  'common.cancel': 'Cancel',
  'common.continue': 'Continue',
  'common.back': 'Back',
  'common.skip': 'Skip',
};

const catalogs: Record<string, Catalog> = { en };
let locale = 'en';
const listeners = new Set<() => void>();

export function registerCatalog(code: string, catalog: Catalog) {
  catalogs[code] = { ...(catalogs[code] ?? {}), ...catalog };
}

export function setLocale(code: string) {
  locale = catalogs[code] ? code : code.split('-')[0] && catalogs[code.split('-')[0]!] ? code.split('-')[0]! : 'en';
  document.documentElement.lang = locale;
  listeners.forEach((l) => l());
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const msg = catalogs[locale]?.[key] ?? en[key] ?? key;
  return msg.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? `{${k}}`));
}

export function useLocale(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => locale,
  );
}

export function greetingKey(hour: number): string {
  if (hour < 5) return 'greeting.night';
  if (hour < 12) return 'greeting.morning';
  if (hour < 18) return 'greeting.afternoon';
  if (hour < 23) return 'greeting.evening';
  return 'greeting.night';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString(locale);
}
