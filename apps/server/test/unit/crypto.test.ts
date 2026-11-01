import { describe, expect, it } from 'vitest';
import { CryptoError, keyId, maskSecret, SecretBox } from '../../src/lib/crypto.js';

const k1 = Buffer.alloc(32, 1);
const k2 = Buffer.alloc(32, 2);

describe('SecretBox', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const box = new SecretBox([k1]);
    const a = box.encrypt('sk-secret');
    const b = box.encrypt('sk-secret');
    expect(a).not.toBe(b);
    expect(box.decrypt(a)).toBe('sk-secret');
    expect(a).not.toContain('sk-secret');
  });
  it('binds ciphertext to associated data', () => {
    const box = new SecretBox([k1]);
    const ct = box.encrypt('v', 'provider:1');
    expect(box.decrypt(ct, 'provider:1')).toBe('v');
    expect(() => box.decrypt(ct, 'provider:2')).toThrow(CryptoError);
    expect(() => box.decrypt(ct)).toThrow(CryptoError);
  });
  it('detects tampering', () => {
    const box = new SecretBox([k1]);
    const parts = box.encrypt('hello').split('.');
    const payload = Buffer.from(parts[3]!, 'base64url');
    payload[payload.length - 1]! ^= 1;
    parts[3] = payload.toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow(/decryption failed/);
  });
  it('rotates keys by re-wrapping the data key', () => {
    const old = new SecretBox([k1]);
    const ct = old.encrypt('rotate-me', 'ctx');
    const rotated = new SecretBox([k2, k1]);
    expect(rotated.needsRotation(ct)).toBe(true);
    const ct2 = rotated.rotate(ct, 'ctx');
    expect(rotated.needsRotation(ct2)).toBe(false);
    expect(ct2.split('.')[3]).toBe(ct.split('.')[3]); // payload untouched
    expect(new SecretBox([k2]).decrypt(ct2, 'ctx')).toBe('rotate-me');
    expect(rotated.rotate(ct2, 'ctx')).toBe(ct2);
  });
  it('fails clearly when a key is missing', () => {
    const ct = new SecretBox([k1]).encrypt('x');
    expect(() => new SecretBox([k2]).decrypt(ct)).toThrow(/not configured/);
    expect(() => new SecretBox([k2]).rotate(ct)).toThrow(/not configured/);
  });
  it('rejects bad formats and keys', () => {
    const box = new SecretBox([k1]);
    expect(() => box.decrypt('nope')).toThrow(/format/);
    expect(() => box.decrypt(`v1.${keyId(k1)}.AA.AA`)).toThrow(/too short/);
    expect(() => new SecretBox([])).toThrow();
    expect(() => new SecretBox([Buffer.alloc(8)])).toThrow(/32 bytes/);
  });
  it('handles unicode and empty strings', () => {
    const box = new SecretBox([k1]);
    expect(box.decrypt(box.encrypt(''))).toBe('');
    expect(box.decrypt(box.encrypt('🔑 ключ'))).toBe('🔑 ключ');
  });
});

describe('maskSecret', () => {
  it('keeps prefix and last 4', () => {
    expect(maskSecret('sk-abcdefghijklmnop1234')).toBe('sk-••••1234');
    expect(maskSecret('abcdefghijkl9876')).toBe('••••9876');
    expect(maskSecret('short')).toBe('••••');
  });
});
