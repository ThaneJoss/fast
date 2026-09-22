import { readFile } from 'node:fs/promises';

// Match the Worker module types in wrangler.toml for Node's test runner.
const root = new URL('../', import.meta.url).href;
export async function load(url, context, nextLoad) {
  if (url.startsWith(root)) {
    const path = url.slice(root.length);
    if (/\.(sh|html|css)$/.test(path) || path === 'admin/app.js') {
      const text = await readFile(new URL(url), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    if (path.startsWith('hosts/')) {
      return { format: 'module', source: await readFile(new URL(url), 'utf8'), shortCircuit: true };
    }
  }
  return nextLoad(url, context);
}
