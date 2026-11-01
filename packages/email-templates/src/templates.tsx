/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Cta, Fallback, Heading, Layout, P, type Brand } from './layout.js';

export interface TemplateProps {
  verify_email: { name: string; url: string; expiresHours: number };
  reset_password: { name: string; url: string; expiresMinutes: number };
  magic_link: { name: string; url: string; expiresMinutes: number };
  change_email: { name: string; url: string; newEmail: string; expiresHours: number };
  email_changed_notice: { name: string; newEmail: string };
  welcome: { name: string; appUrl: string };
  invite: { inviterName: string; targetName: string; url: string };
  security_alert: { name: string; event: string; ip: string; userAgent: string; when: string; settingsUrl: string };
  digest: { name: string; items: { title: string; body: string; url?: string }[]; settingsUrl: string };
  test_email: { sentBy: string };
}
export type TemplateName = keyof TemplateProps;

interface Def<P> {
  subject: (p: P, b: Brand) => string;
  html: (p: P, b: Brand) => React.ReactElement;
  text: (p: P, b: Brand) => string;
}

type Registry = { [K in TemplateName]: Def<TemplateProps[K]> };

export const templates: Registry = {
  verify_email: {
    subject: (_p, b) => `Verify your email for ${b.productName}`,
    html: (p, b) => (
      <Layout brand={b} preview="Confirm your email address">
        <Heading>Confirm your email</Heading>
        <P>Hi {p.name}, please confirm this is your email address to unlock all features.</P>
        <Cta href={p.url} label="Verify email" color={b.accentColor} />
        <P>This link expires in {p.expiresHours} hours and can be used once.</P>
        <Fallback href={p.url} />
      </Layout>
    ),
    text: (p, b) =>
      `Hi ${p.name},\n\nConfirm your email for ${b.productName}:\n${p.url}\n\nThis link expires in ${p.expiresHours} hours and can be used once.`,
  },
  reset_password: {
    subject: (_p, b) => `Reset your ${b.productName} password`,
    html: (p, b) => (
      <Layout brand={b} preview="Reset your password">
        <Heading>Reset your password</Heading>
        <P>Hi {p.name}, someone asked to reset your password. If that was you, choose a new one below.</P>
        <Cta href={p.url} label="Choose a new password" color={b.accentColor} />
        <P>This link expires in {p.expiresMinutes} minutes. If you didn’t ask for this, you can ignore this email.</P>
        <Fallback href={p.url} />
      </Layout>
    ),
    text: (p) =>
      `Hi ${p.name},\n\nReset your password:\n${p.url}\n\nThis link expires in ${p.expiresMinutes} minutes. If you didn't ask for this, ignore this email.`,
  },
  magic_link: {
    subject: (_p, b) => `Your ${b.productName} sign-in link`,
    html: (p, b) => (
      <Layout brand={b} preview="Sign in with one click">
        <Heading>Sign in</Heading>
        <P>Hi {p.name}, use this link to sign in. It expires in {p.expiresMinutes} minutes.</P>
        <Cta href={p.url} label="Sign in" color={b.accentColor} />
        <Fallback href={p.url} />
      </Layout>
    ),
    text: (p) => `Hi ${p.name},\n\nSign in:\n${p.url}\n\nThis link expires in ${p.expiresMinutes} minutes.`,
  },
  change_email: {
    subject: (_p, b) => `Confirm your new ${b.productName} email`,
    html: (p, b) => (
      <Layout brand={b} preview="Confirm your new email address">
        <Heading>Confirm your new email</Heading>
        <P>Hi {p.name}, confirm that {p.newEmail} should become your sign-in email.</P>
        <Cta href={p.url} label="Confirm new email" color={b.accentColor} />
        <P>This link expires in {p.expiresHours} hours.</P>
        <Fallback href={p.url} />
      </Layout>
    ),
    text: (p) => `Hi ${p.name},\n\nConfirm ${p.newEmail} as your new email:\n${p.url}\n\nExpires in ${p.expiresHours} hours.`,
  },
  email_changed_notice: {
    subject: (_p, b) => `Your ${b.productName} email was changed`,
    html: (p, b) => (
      <Layout brand={b} preview="Your email address was changed">
        <Heading>Email changed</Heading>
        <P>Hi {p.name}, your account email was changed to {p.newEmail}. If you didn’t do this, contact {b.supportEmail} right away.</P>
      </Layout>
    ),
    text: (p, b) => `Hi ${p.name},\n\nYour account email was changed to ${p.newEmail}. If you didn't do this, contact ${b.supportEmail}.`,
  },
  welcome: {
    subject: (_p, b) => `Welcome to ${b.productName}`,
    html: (p, b) => (
      <Layout brand={b} preview={`Welcome to ${b.productName}`}>
        <Heading>Welcome, {p.name}!</Heading>
        <P>Your account is ready. Start a chat, create a project, or explore themes in the workshop.</P>
        <Cta href={p.appUrl} label={`Open ${b.productName}`} color={b.accentColor} />
      </Layout>
    ),
    text: (p, b) => `Welcome, ${p.name}!\n\nYour ${b.productName} account is ready: ${p.appUrl}`,
  },
  invite: {
    subject: (p, b) => `${p.inviterName} invited you to ${p.targetName} on ${b.productName}`,
    html: (p, b) => (
      <Layout brand={b} preview={`${p.inviterName} invited you`}>
        <Heading>You’re invited</Heading>
        <P>
          {p.inviterName} invited you to collaborate on “{p.targetName}”.
        </P>
        <Cta href={p.url} label="Accept invite" color={b.accentColor} />
        <Fallback href={p.url} />
      </Layout>
    ),
    text: (p) => `${p.inviterName} invited you to "${p.targetName}".\n\nAccept: ${p.url}`,
  },
  security_alert: {
    subject: (p, b) => `Security alert for your ${b.productName} account: ${p.event}`,
    html: (p, b) => (
      <Layout brand={b} preview={p.event}>
        <Heading>{p.event}</Heading>
        <P>Hi {p.name}, we noticed this activity on your account:</P>
        <P>
          When: {p.when}
          <br />
          IP address: {p.ip}
          <br />
          Device: {p.userAgent}
        </P>
        <P>If this was you, no action is needed. If not, change your password and sign out other sessions.</P>
        <Cta href={p.settingsUrl} label="Review security settings" color={b.accentColor} />
      </Layout>
    ),
    text: (p) =>
      `Hi ${p.name},\n\n${p.event}\nWhen: ${p.when}\nIP: ${p.ip}\nDevice: ${p.userAgent}\n\nIf this wasn't you, review your security settings: ${p.settingsUrl}`,
  },
  digest: {
    subject: (p, b) => `Your ${b.productName} digest: ${p.items.length} update${p.items.length === 1 ? '' : 's'}`,
    html: (p, b) => (
      <Layout brand={b} preview={`${p.items.length} updates`}>
        <Heading>Here’s what happened</Heading>
        {p.items.map((item, i) => (
          <P key={i}>
            <strong>{item.title}</strong>
            <br />
            {item.body}
            {item.url ? (
              <>
                <br />
                <a href={item.url}>Open</a>
              </>
            ) : null}
          </P>
        ))}
        <P>
          <a href={p.settingsUrl}>Notification settings</a>
        </P>
      </Layout>
    ),
    text: (p) =>
      `Hi ${p.name},\n\n${p.items.map((i) => `* ${i.title}\n  ${i.body}${i.url ? `\n  ${i.url}` : ''}`).join('\n\n')}\n\nNotification settings: ${p.settingsUrl}`,
  },
  test_email: {
    subject: (_p, b) => `${b.productName} test email`,
    html: (p, b) => (
      <Layout brand={b} preview="Test email">
        <Heading>It works!</Heading>
        <P>This test email was sent by {p.sentBy} from the admin console.</P>
      </Layout>
    ),
    text: (p) => `It works! This test email was sent by ${p.sentBy}.`,
  },
};
