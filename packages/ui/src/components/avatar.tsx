import { useState } from 'react';
import { cn } from '../lib/cn.js';

const PALETTE = ['#5b4bdb', '#1d6fb8', '#17803d', '#a35a00', '#c62a2f', '#8a3ffc', '#007d79', '#b8326a', '#4a5568', '#9a4a1e'];

/** Deterministic color per seed so a user's fallback avatar is stable across devices. */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = [...parts[0]!][0] ?? '';
  const last = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ src, name, seed, size = 32, className }: { src?: string | null; name: string; seed?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4), background: showImage ? undefined : avatarColor(seed ?? name) }}
      role="img"
      aria-label={name}
    >
      {showImage ? <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : <span aria-hidden="true">{initials(name)}</span>}
    </span>
  );
}
