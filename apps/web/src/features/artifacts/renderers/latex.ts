/**
 * Converts a LaTeX document into Markdown + math so it can be previewed with KaTeX. This covers the
 * document structure people actually write (sections, emphasis, lists, quotes, verbatim, tables are kept
 * as code) — it is a preview, not a TeX engine. Unknown commands keep their text arguments.
 */
export function latexToMarkdown(src: string): { markdown: string; title: string | null; author: string | null } {
  let s = src.replace(/\r\n/g, '\n');
  const title = /\\title\{([^}]*)\}/.exec(s)?.[1] ?? null;
  const author = /\\author\{([^}]*)\}/.exec(s)?.[1] ?? null;
  const body = /\\begin\{document\}([\s\S]*?)(\\end\{document\}|$)/.exec(s);
  if (body) s = body[1]!;
  // Strip comments (but not escaped \%).
  s = s.replace(/(^|[^\\])%.*$/gm, '$1');

  // Protect verbatim and math first so later rules don't touch their contents.
  const slots: string[] = [];
  const keep = (text: string) => `\uE000${slots.push(text) - 1}\uE000`;
  s = s.replace(/\\begin\{(verbatim|lstlisting|minted)\}(?:\{[^}]*\})?([\s\S]*?)\\end\{\1\}/g, (_, _env, code: string) => keep(`\n\`\`\`\n${code.replace(/^\n|\n$/g, '')}\n\`\`\`\n`));
  s = s.replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, (_, env: string, m: string) => keep(`\n$$\n${env.startsWith('align') || env === 'eqnarray' ? `\\begin{aligned}${m.replace(/\\label\{[^}]*\}/g, '')}\\end{aligned}` : m.replace(/\\label\{[^}]*\}/g, '').trim()}\n$$\n`));
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, m: string) => keep(`\n$$\n${m.trim()}\n$$\n`));
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, m: string) => keep(`\n$$\n${m.trim()}\n$$\n`));
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, m: string) => keep(`$${m}$`));
  s = s.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_, pre: string, m: string) => `${pre}${keep(`$${m}$`)}`);
  s = s.replace(/\\begin\{tabular\}(\{[^}]*\})?([\s\S]*?)\\end\{tabular\}/g, (_, _spec, t: string) => keep(tabularToMarkdown(t)));

  s = s.replace(/\\maketitle/g, '');
  s = s.replace(/\\tableofcontents/g, '');
  s = s.replace(/\\(chapter|section|subsection|subsubsection|paragraph)\*?\{([^}]*)\}/g, (_, level: string, text: string) => {
    const hashes = { chapter: '#', section: '##', subsection: '###', subsubsection: '####', paragraph: '#####' }[level as 'section'];
    return `\n${hashes} ${text}\n`;
  });
  s = s.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g, (_, t: string) => `\n**Abstract.** ${t.trim()}\n`);
  s = s.replace(/\\begin\{(quote|quotation)\}([\s\S]*?)\\end\{\1\}/g, (_, _e, t: string) => `\n${t.trim().split('\n').map((l) => `> ${l.trim()}`).join('\n')}\n`);

  // Lists (nested lists indent by depth).
  const lines: string[] = [];
  const stack: ('ul' | 'ol')[] = [];
  for (const line of s.split('\n')) {
    const begin = /^\s*\\begin\{(itemize|enumerate|description)\}\s*$/.exec(line);
    if (begin) {
      stack.push(begin[1] === 'enumerate' ? 'ol' : 'ul');
      continue;
    }
    if (/^\s*\\end\{(itemize|enumerate|description)\}\s*$/.test(line)) {
      stack.pop();
      lines.push('');
      continue;
    }
    const item = /^\s*\\item(?:\[([^\]]*)\])?\s*(.*)$/.exec(line);
    if (item && stack.length) {
      const indent = '  '.repeat(stack.length - 1);
      const marker = stack[stack.length - 1] === 'ol' ? '1.' : '-';
      lines.push(`${indent}${marker} ${item[1] ? `**${item[1]}** ` : ''}${item[2]}`);
      continue;
    }
    lines.push(stack.length ? `${'  '.repeat(stack.length)}${line.trim()}` : line);
  }
  s = lines.join('\n');

  // Inline formatting.
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/\\textbf\{([^{}]*)\}/g, '**$1**')
      .replace(/\\(?:textit|emph)\{([^{}]*)\}/g, '*$1*')
      .replace(/\\texttt\{([^{}]*)\}/g, '`$1`')
      .replace(/\\underline\{([^{}]*)\}/g, '$1')
      .replace(/\\href\{([^}]*)\}\{([^{}]*)\}/g, '[$2]($1)')
      .replace(/\\url\{([^}]*)\}/g, '<$1>')
      .replace(/\\footnote\{([^{}]*)\}/g, ' ($1)');
  }
  s = s
    .replace(/\\(label|ref|cite|eqref|vspace|hspace|setlength|usepackage|documentclass)\*?(\[[^\]]*\])?\{[^}]*\}/g, (m, cmd: string) => (cmd === 'ref' || cmd === 'eqref' || cmd === 'cite' ? '[?]' : ''))
    .replace(/\\(newpage|clearpage|noindent|centering|par|medskip|bigskip|smallskip)\b/g, '\n')
    .replace(/\\\\(\[[^\]]*\])?/g, '  \n')
    .replace(/\\(begin|end)\{(center|flushleft|flushright|figure|table|minipage)\}(\[[^\]]*\])?(\{[^}]*\})?/g, '')
    .replace(/~/g, ' ')
    .replace(/``|''/g, '"')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/\\([%$&#_{}])/g, '$1')
    .replace(/\\LaTeX\b/g, 'LaTeX')
    .replace(/\\TeX\b/g, 'TeX')
    .replace(/\\ldots|\\dots/g, '…')
    .replace(/\\[a-zA-Z]+\*?\{([^{}]*)\}/g, '$1');

  s = s.replace(/\uE000(\d+)\uE000/g, (_, i: string) => slots[Number(i)]!);
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  const header = [title ? `# ${title}` : '', author ? `*${author}*` : ''].filter(Boolean).join('\n\n');
  return { markdown: header ? `${header}\n\n${s}` : s, title, author };
}

function tabularToMarkdown(t: string): string {
  const rows = t
    .replace(/\\hline|\\toprule|\\midrule|\\bottomrule/g, '')
    .split(/\\\\/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split('&').map((c) => c.trim().replace(/\|/g, '\\|')));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const [head, ...rest] = rows;
  return `\n| ${pad(head!).join(' | ')} |\n|${' --- |'.repeat(width)}\n${rest.map((r) => `| ${pad(r).join(' | ')} |`).join('\n')}\n`;
}
