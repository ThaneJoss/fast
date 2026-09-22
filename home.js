import page from './home/index.html';
import setup from './setup.sh';

export default function home(request, env) {
  const url = new URL(request.url);
  const format = url.searchParams.get('format');
  const html = format === 'html' || (format !== 'script' && prefersHTML(request.headers.get('accept') ?? ''));
  const headers = {
    'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Accept',
    'X-Content-Type-Options': 'nosniff',
  };
  if (html) {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    headers['Referrer-Policy'] = 'same-origin';
  }
  if (request.method === 'HEAD') return new Response(null, { headers });
  if (html) return new Response(page, { headers });

  const registry = `${url.origin}/registry.npmjs.org/`;
  const script = setup
    .replaceAll('__FAST_VERSION__', env.CF_VERSION_METADATA.id)
    .replaceAll('__FAST_NPM_REGISTRY__', () => `'${registry.replaceAll("'", "'\\''")}'`);
  return new Response(script, { headers });
}

function prefersHTML(accept) {
  const ranges = accept.toLowerCase().split(',').map(value => {
    const [type, ...parameters] = value.trim().split(';');
    const parameter = parameters.map(part => part.trim()).find(part => /^q\s*=/.test(part));
    const q = parameter === undefined ? 1 : Number(parameter.slice(parameter.indexOf('=') + 1).trim());
    return { type: type.trim(), q: Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0 };
  });
  // Wildcards alone (including curl's */*) must keep returning the shell script.
  if (!ranges.some(range => range.type === 'text/html')) return false;
  const quality = type => {
    for (const match of [type, 'text/*', '*/*']) {
      const matches = ranges.filter(range => range.type === match);
      if (matches.length) return Math.max(...matches.map(range => range.q));
    }
    return 0;
  };
  return quality('text/html') > 0 && quality('text/html') >= quality('text/plain');
}
