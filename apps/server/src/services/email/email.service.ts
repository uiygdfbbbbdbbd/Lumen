import { renderEmail, type TemplateName, type TemplateProps } from '@lumen/email-templates';
import type { Logger } from 'pino';
import type { Database } from '../../db/client.js';
import { emailLogs } from '../../db/schema/index.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { EmailTransport } from './transports.js';

export class EmailService {
  constructor(
    private readonly db: Database,
    private readonly transport: EmailTransport,
    private readonly settings: SettingsService,
    private readonly opts: { from: string; publicUrl: string },
    private readonly log: Logger,
  ) {}

  get transportName() {
    return this.transport.name;
  }

  /**
   * Render and send. Failures are logged (status=failed) and rethrown so callers decide
   * whether to surface them; secrets are never part of email logs (only template + recipient).
   */
  async send<K extends TemplateName>(template: K, to: string, props: TemplateProps[K]): Promise<void> {
    const branding = await this.settings.get('branding');
    const rendered = await renderEmail(template, props, {
      productName: branding.productName,
      accentColor: branding.accentColor,
      publicUrl: this.opts.publicUrl,
      supportEmail: branding.supportEmail,
    });
    const from = this.opts.from.replace(/^Lumen\b/, branding.productName);
    try {
      const { messageId } = await this.transport.send({ from, to, ...rendered });
      await this.db.insert(emailLogs).values({ to, template, subject: rendered.subject, status: 'sent', providerMessageId: messageId });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.error({ template, err: error }, 'email send failed');
      await this.db.insert(emailLogs).values({ to, template, subject: rendered.subject, status: 'failed', error: error.slice(0, 500) });
      throw err;
    }
  }
}
