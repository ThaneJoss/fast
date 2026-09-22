import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const escapeHTML = value => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

function safeURL(href, image = false) {
  try {
    const url = new URL(href, 'https://fast.thanejoss.com/');
    return (image ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:']).includes(url.protocol);
  } catch {
    return false;
  }
}

export function renderHome(markdown, template) {
  const headings = [];
  const ids = new Set(['top', 'main', 'toc-label']);
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const label = this.parser.parseInline(tokens);
        const slug = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
        let id = slug;
        for (let suffix = 2; ids.has(id); suffix++) id = `${slug}-${suffix}`;
        ids.add(id);
        if (depth === 2) headings.push(`<li><a href="#${id}">${escapeHTML(text)}</a></li>`);
        return `<h${depth} id="${id}">${label}</h${depth}>\n`;
      },
      // README is maintained in the repo; still keep raw HTML and active URLs inert.
      html({ text }) { return escapeHTML(text); },
      link({ href, title, tokens }) {
        const label = this.parser.parseInline(tokens);
        if (!safeURL(href)) return label;
        return `<a href="${escapeHTML(href)}"${title ? ` title="${escapeHTML(title)}"` : ''}>${label}</a>`;
      },
      image({ href, title, text }) {
        if (!safeURL(href, true)) return escapeHTML(text);
        return `<img src="${escapeHTML(href)}" alt="${escapeHTML(text)}"${title ? ` title="${escapeHTML(title)}"` : ''} loading="lazy">`;
      },
    },
  });
  const content = marked.parse(markdown);
  const slots = { CONTENT: content, TOC: `<ul>${headings.join('\n')}</ul>` };
  return template.replace(/\{\{(CONTENT|TOC)\}\}/g, (_, name) => slots[name]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [markdown, template] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../home/template.html', import.meta.url), 'utf8'),
  ]);
  await writeFile(new URL('../home/index.html', import.meta.url), renderHome(markdown, template));
  console.log('Rendered README.md → home/index.html');
}
