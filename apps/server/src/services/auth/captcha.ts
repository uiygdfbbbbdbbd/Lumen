export interface CaptchaVerifier {
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

export const noCaptcha: CaptchaVerifier = { verify: async () => true };

const ENDPOINTS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
} as const;

export function remoteCaptcha(provider: keyof typeof ENDPOINTS, secret: string, fetchImpl: typeof fetch = fetch): CaptchaVerifier {
  return {
    async verify(token, ip) {
      if (!token) return false;
      try {
        const res = await fetchImpl(ENDPOINTS[provider], {
          method: 'POST',
          body: new URLSearchParams({ secret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { success?: boolean };
        return data.success === true;
      } catch {
        return false;
      }
    },
  };
}
