/** Common disposable-email domains. Admins can toggle blocking; list is intentionally conservative. */
export const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com', '20minutemail.com', '33mail.com', 'anonaddy.me', 'burnermail.io', 'byom.de', 'deadaddress.com',
  'discard.email', 'disposablemail.com', 'dispostable.com', 'dropmail.me', 'emailondeck.com', 'fakeinbox.com',
  'fakemail.net', 'getairmail.com', 'getnada.com', 'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de',
  'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'harakirimail.com',
  'inboxbear.com', 'incognitomail.org', 'jetable.org', 'mailcatch.com', 'maildrop.cc', 'mailinator.com',
  'mailinator.net', 'mailinator2.com', 'mailnesia.com', 'mailpoof.com', 'mailsac.com', 'mailtemp.net', 'mintemail.com',
  'moakt.com', 'mohmal.com', 'mytemp.email', 'mytrashmail.com', 'nada.email', 'no-spam.ws', 'nowmymail.com',
  'one-off.email', 'sharklasers.com', 'spam4.me', 'spambog.com', 'spamgourmet.com', 'spamex.com', 'tempail.com',
  'tempinbox.com', 'tempmail.com', 'tempmail.dev', 'tempmail.net', 'tempmail.plus', 'tempmailo.com', 'temp-mail.io',
  'temp-mail.org', 'tempr.email', 'throwawaymail.com', 'tmail.ws', 'tmpmail.net', 'tmpmail.org', 'trash-mail.com',
  'trashmail.com', 'trashmail.de', 'trashmail.net', 'wegwerfmail.de', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'zetmail.com', 'emailfake.com', 'fakemailgenerator.com', 'mailforspam.com', 'spambox.us', 'grr.la', 'pokemail.net',
]);

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

export function isDisposable(email: string): boolean {
  const domain = emailDomain(email);
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Subdomains of known disposable providers (e.g. abc.mailinator.com).
  for (const d of DISPOSABLE_DOMAINS) if (domain.endsWith(`.${d}`)) return true;
  return false;
}

export function domainAllowed(email: string, allowlist: string[]): boolean {
  const domain = emailDomain(email);
  return allowlist.some((d) => {
    const n = d.toLowerCase().replace(/^@/, '');
    return domain === n || domain.endsWith(`.${n}`);
  });
}
