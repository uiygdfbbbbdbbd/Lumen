/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

export interface Brand {
  productName: string;
  accentColor: string;
  publicUrl: string;
  supportEmail: string;
}

export function Layout({ brand, preview, children }: { brand: Brand; preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: '#f6f6f9', fontFamily: 'Inter, -apple-system, Segoe UI, Roboto, sans-serif', margin: 0 }}>
        <Container style={{ maxWidth: 520, margin: '32px auto', backgroundColor: '#ffffff', borderRadius: 12, padding: '32px 32px 24px' }}>
          <Text style={{ fontSize: 20, fontWeight: 700, color: brand.accentColor, margin: '0 0 24px' }}>{brand.productName}</Text>
          {children}
          <Hr style={{ borderColor: '#ececf1', margin: '28px 0 16px' }} />
          <Text style={{ fontSize: 12, color: '#8a8a99', margin: 0 }}>
            You received this email because of activity on your {brand.productName} account. Questions? Contact {brand.supportEmail}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 22, fontWeight: 600, color: '#16161d', margin: '0 0 12px' }}>{children}</Text>;
}

export function P({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 15, lineHeight: '24px', color: '#3a3a48', margin: '0 0 14px' }}>{children}</Text>;
}

export function Cta({ href, label, color }: { href: string; label: string; color: string }) {
  return (
    <Section style={{ margin: '20px 0' }}>
      <Button href={href} style={{ backgroundColor: color, color: '#ffffff', borderRadius: 8, padding: '12px 20px', fontSize: 15, fontWeight: 600 }}>
        {label}
      </Button>
    </Section>
  );
}

export function Fallback({ href }: { href: string }) {
  return (
    <Text style={{ fontSize: 12, color: '#8a8a99', wordBreak: 'break-all' }}>
      If the button doesn’t work, paste this link into your browser: {href}
    </Text>
  );
}
