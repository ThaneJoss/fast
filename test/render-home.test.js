import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHome } from '../scripts/render-home.js';

const template = '<nav>{{TOC}}</nav><main>{{CONTENT}}</main>';

test('headings receive unique anchors, including reserved page IDs and Unicode titles', () => {
  const html = renderHome('# Top\n## Main\n## Main\n## 中文标题\n### Details\n', template);
  assert.match(html, /<h1 id="top-2">Top<\/h1>/);
  assert.match(html, /<h2 id="main-2">Main<\/h2>/);
  assert.match(html, /<h2 id="main-3">Main<\/h2>/);
  assert.match(html, /<h2 id="中文标题">中文标题<\/h2>/);
  assert.match(html, /<a href="#main-2">Main<\/a>/);
  assert.match(html, /<a href="#main-3">Main<\/a>/);
  assert.match(html, /<a href="#中文标题">中文标题<\/a>/);
  assert.doesNotMatch(html.split('</nav>')[0], /Details|href="#top-2"/);
  assert.doesNotMatch(html, /\{\{(?:CONTENT|TOC)\}\}/);
});

test('raw HTML and active link/image URLs cannot become executable markup', () => {
  const html = renderHome([
    '<script>alert("unsafe")</script>',
    '',
    '[bad](javascript:alert) [bad-entity](jav&#x61;script:alert)',
    '[vb](vbscript:alert) ![image fallback](data:image/svg+xml,unsafe)',
    '',
    '## <img src=x onerror=alert(1)>',
  ].join('\n'), template);
  assert.doesNotMatch(html, /<script|<img|href="(?:javascript|vbscript):|src="data:/i);
  assert.match(html, /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/);
  assert.match(html, /<p>bad /);
  assert.match(html, /href="jav&amp;#x61;script:alert">bad-entity<\/a>/, 'entity text is escaped instead of becoming a javascript scheme');
  assert.match(html, /image fallback/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('allowed links, code blocks and image attributes retain escaped document content', () => {
  const html = renderHome([
    '[docs](https://example.org/?a=1&b=2 "A & B")',
    '[local](./guide) [email](mailto:person@example.org)',
    '![An & image](https://example.org/image.png "A & B")',
    '',
    '```sh',
    'echo "<script>"',
    '```',
  ].join('\n'), template);
  assert.match(html, /href="https:\/\/example.org\/\?a=1&amp;b=2" title="A &amp; B"/);
  assert.match(html, /href="\.\/guide"/);
  assert.match(html, /href="mailto:person@example.org"/);
  assert.match(html, /alt="An &amp; image" title="A &amp; B" loading="lazy"/);
  assert.match(html, /<pre tabindex="0" role="region" aria-label="代码示例 1"><code class="language-sh">echo &quot;&lt;script&gt;&quot;/);
});

test('code regions have unique accessible names that reset for every rendered document', () => {
  const markdown = [
    '```bash',
    'echo first',
    '```',
    '',
    '```javascript',
    'console.log("second");',
    '```',
    '',
    '    echo third',
  ].join('\n');
  const html = renderHome(markdown, template);
  const labels = [...html.matchAll(/<pre tabindex="0" role="region" aria-label="([^"]+)">/g)]
    .map(match => match[1]);
  assert.deepEqual(labels, ['代码示例 1', '代码示例 2', '代码示例 3']);

  const otherDocument = renderHome('```\necho another document\n```', template);
  assert.match(otherDocument, /aria-label="代码示例 1"/);
  assert.equal(renderHome(markdown, template), html, 'repeated renders produce the same names');
});
