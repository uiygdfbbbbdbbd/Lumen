import { render } from '@react-email/render';
import { templates, type TemplateName, type TemplateProps } from './templates.js';
import type { Brand } from './layout.js';

export type { Brand } from './layout.js';
export type { TemplateName, TemplateProps } from './templates.js';
export const TEMPLATE_NAMES = Object.keys(templates) as TemplateName[];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Render a branded email. React escapes all interpolated values, so user-provided names can't inject HTML. */
export async function renderEmail<K extends TemplateName>(name: K, props: TemplateProps[K], brand: Brand): Promise<RenderedEmail> {
  const def = templates[name];
  const subject = def.subject(props, brand).replace(/[\r\n]+/g, ' ');
  const html = await render(def.html(props, brand));
  return { subject, html, text: def.text(props, brand) };
}
