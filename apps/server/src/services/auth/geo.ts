import type { FastifyRequest } from 'fastify';

/**
 * Coarse location (country) from trusted reverse-proxy headers. No GeoIP database ships with Lumen;
 * Cloudflare/Vercel/Fastly-style headers are used when TRUST_PROXY is on.
 */
export function coarseLocation(req: FastifyRequest, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const h = req.headers;
  const country = h['cf-ipcountry'] ?? h['x-vercel-ip-country'] ?? h['x-country-code'] ?? h['fastly-geo-country'];
  const value = Array.isArray(country) ? country[0] : country;
  if (!value || !/^[A-Z]{2}$/.test(value) || value === 'XX') return null;
  return value;
}

/** Short, human-readable device label from a user agent string. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  const browser =
    /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Lumen/.test(ua) ? 'Lumen desktop' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}
