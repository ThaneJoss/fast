import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const entries = await readdir(new URL('hosts/', root), { withFileTypes: true });
const handlers = [];
for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  if (entry.name.startsWith('.')) continue;
  if (!entry.isFile() || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(entry.name)) {
    throw new Error(`Invalid host filename: ${entry.name}`);
  }
  const logic = await readFile(new URL(`hosts/${entry.name}`, root), 'utf8');
  handlers.push(`[${JSON.stringify(entry.name)}, async ({ request, target, proxy }) => {\n${logic}\n}]`);
}
const template = await readFile(new URL('src/index.js', root), 'utf8');
const output = template.replace('/* HOST_HANDLERS */', () => handlers.join(',\n'));
execFileSync(process.execPath, ['--input-type=module', '--check'], { input: output });
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/worker.js', root), output);
console.log(`Built ${handlers.length} hosts → ${fileURLToPath(new URL('dist/worker.js', root))}`);
