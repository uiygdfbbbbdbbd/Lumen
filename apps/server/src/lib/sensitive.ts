/**
 * Detects secrets that must never be stored as memories (or similar long-lived user data):
 * credentials, keys, card and account numbers. Returns a human-readable reason, or null.
 */
const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/, 'an API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'a cloud access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'an access token'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'an access token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'an API key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'an access token'],
  [/\b(?:password|passcode|passwd|pwd)\s*(?:is|=|:)\s*\S+/i, 'a password'],
  [/\bpin(?: code| number)?\s*(?:is|=|:)\s*\d{4,}/i, 'a PIN'],
  [/\b(?:api[ _-]?key|access token|token|client secret|secret)\s*(?:is|=|:)\s*(?=\S*[\d_-])\S{8,}/i, 'a secret key'],
  [/\b\d{3}-\d{2}-\d{4}\b/, 'a government ID number'],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/, 'a bank account number'],
];

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function detectSecret(text: string): string | null {
  for (const [re, what] of PATTERNS) if (re.test(text)) return what;
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return 'a payment card number';
  }
  return null;
}
