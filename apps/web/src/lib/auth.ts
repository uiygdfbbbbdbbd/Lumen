import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LumenError, type Entitlements, type Feature, type Me, type Permission } from '@lumen/shared';
import { api } from './api.js';

export interface MeResponse {
  user: Me;
  entitlements: Entitlements;
  permissions: Permission[];
}

export interface PublicConfig {
  branding: { productName: string; tagline: string; accentColor: string; loginCopy: string; tosUrl: string; privacyUrl: string; supportEmail: string };
  signup: { mode: 'open' | 'closed' | 'invite' | 'allowlist'; requireVerification: boolean; captcha: string; captchaSiteKey: string; minimumAge: number };
  auth: { magicLink: boolean; passkeys: boolean; oauth: string[] };
  maintenance: { enabled: boolean; readOnly: boolean; message: string };
  legal: { tosVersion: string; cookieConsent: boolean };
}

export const ME_KEY = ['me'] as const;

export function usePublicConfig() {
  return useQuery({ queryKey: ['public-config'], queryFn: () => api<PublicConfig>('/api/public/config'), staleTime: 60_000 });
}

/** null = signed out. Errors other than 401 propagate so the UI can show them. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api<MeResponse>('/api/me');
      } catch (err) {
        if (err instanceof LumenError && (err.code === 'UNAUTHENTICATED' || err.code === 'ACCOUNT_SUSPENDED')) return null;
        throw err;
      }
    },
    staleTime: 30_000,
  });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (data: MeResponse | null) => qc.setQueryData(ME_KEY, data);
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    },
  });
}

export function featureState(me: MeResponse | null | undefined, feature: Feature) {
  return me?.entitlements.features[feature] ?? { allowed: false, reason: 'EMAIL_UNVERIFIED' as const };
}

export function hasPermission(me: MeResponse | null | undefined, p: Permission): boolean {
  return Boolean(me?.permissions.includes(p));
}

export const meQueryOptions = {
  queryKey: ME_KEY,
  queryFn: async (): Promise<MeResponse | null> => {
    try {
      return await api<MeResponse>('/api/me');
    } catch (err) {
      if (err instanceof LumenError && (err.code === 'UNAUTHENTICATED' || err.code === 'ACCOUNT_SUSPENDED')) return null;
      throw err;
    }
  },
  staleTime: 30_000,
};
