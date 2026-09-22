import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, lstatSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const template = readFileSync(join(project, 'setup.sh'), 'utf8');
const registry = 'https://fast.thanejoss.com/registry.npmjs.org/';
const version = 'test-version';
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(t) {
  const root = mkdtempSync(join(project, '.setup-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const apt = join(root, 'etc/apt');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  for (const path of [join(apt, 'sources.list.d'), home, bin]) mkdirSync(path, { recursive: true });
  const release = join(root, 'etc/os-release');
  writeFileSync(release, 'ID=ubuntu\nVERSION_CODENAME=noble\n');
  writeFileSync(join(apt, 'sources.list'), [
    'deb http://archive.ubuntu.com/ubuntu noble main restricted',
    'deb http://security.ubuntu.com/ubuntu noble-security main restricted',
    'deb https://example.org/packages stable main',
    '',
  ].join('\n'));
  const account = userInfo();
  writeFileSync(join(bin, 'getent'), `#!/bin/sh
[ "$1" = passwd ] && [ "$2" = "$FAST_TEST_USER" ] || exit 1
printf '%s:x:%s:%s::%s:/bin/bash\\n' "$FAST_TEST_USER" "$FAST_TEST_UID" "$FAST_TEST_GID" "$FAST_TEST_HOME"
`, { mode: 0o755 });
  // Run the complete rendered script via stdin, but keep every writable system
  // path and the passwd lookup inside the fixture, even when tests run as root.
  const script = template
    .replaceAll('/etc/apt', quote(apt))
    .replaceAll('/etc/os-release', quote(release))
    .replaceAll('__FAST_VERSION__', version)
    .replaceAll('__FAST_NPM_REGISTRY__', quote(registry));
  assert.doesNotMatch(script.replaceAll(quote(apt), '').replaceAll(quote(release), ''), /\/etc\/(apt|os-release)/, 'system paths must be redirected');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAST_TEST_USER: account.username,
    FAST_TEST_UID: String(account.uid),
    FAST_TEST_GID: String(account.gid),
    FAST_TEST_HOME: home,
  };
  for (const key of ['SUDO_USER', 'BASH_ENV', 'ENV']) delete env[key];
  const sources = join(apt, 'sources.list.d/ubuntu.sources');
  const npmrc = join(home, '.npmrc');
  return {
    apt, home, release, sources, npmrc,
    run() {
      const result = spawnSync('bash', ['--noprofile', '--norc', '-s'], { input: script, env, encoding: 'utf8' });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return result.stdout;
    },
  };
}

function contents(path) {
  return readFileSync(path, 'utf8');
}

function unchangedSnapshot(path) {
  // An old mtime detects rewrites even on filesystems with coarse timestamps.
  utimesSync(path, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  const stat = statSync(path);
  return { contents: contents(path), ino: stat.ino, mtimeMs: stat.mtimeMs, mode: stat.mode, uid: stat.uid, gid: stat.gid };
}

function assertUnchanged(path, before) {
  const stat = statSync(path);
  assert.deepEqual({ contents: contents(path), ino: stat.ino, mtimeMs: stat.mtimeMs, mode: stat.mode, uid: stat.uid, gid: stat.gid }, before);
}

function sourceBlock(text, host) {
  const start = `### fast.thanejoss.com/${host} Version ${version}`;
  const end = `### End Version ${version}`;
  assert.equal(text.split(start).length - 1, 1, `one managed block for ${host}`);
  const offset = text.indexOf(start);
  const finish = text.indexOf(end, offset);
  assert.notEqual(finish, -1, `closing marker for ${host}`);
  return text.slice(offset, finish + end.length);
}

test('first run configures Ubuntu and npm; second run leaves files untouched', t => {
  const f = fixture(t);
  const first = f.run();
  assert.match(first, /\[已修改\] Ubuntu 主源/);
  assert.match(first, /\[已修改\] Ubuntu 安全源/);
  assert.match(first, /\[已修改\] npm registry/);
  assert.match(first.trimEnd().split('\n').at(-1), /^\[完成\]/);
  assert.match(sourceBlock(contents(f.sources), 'archive.ubuntu.com'), /URIs: https:\/\/fast\.thanejoss\.com\/archive\.ubuntu\.com\/ubuntu\//);
  assert.match(sourceBlock(contents(f.sources), 'security.ubuntu.com'), /Suites: noble-security/);
  assert.equal(contents(f.npmrc), `registry=${registry}\n`);
  assert.equal(statSync(f.npmrc).mode & 0o777, 0o600);
  assert.equal(contents(join(f.apt, 'sources.list')), 'deb https://example.org/packages stable main\n');
  const before = [f.sources, f.npmrc, join(f.apt, 'sources.list')].map(path => [path, unchangedSnapshot(path)]);
  const second = f.run();
  assert.match(second, /\[未修改\] Ubuntu 主源/);
  assert.match(second, /\[未修改\] Ubuntu 安全源/);
  assert.match(second, /\[未修改\] npm registry/);
  assert.match(second.trimEnd().split('\n').at(-1), /^\[完成\]/);
  for (const [path, snapshot] of before) assertUnchanged(path, snapshot);
});

for (const [host, label] of [['archive.ubuntu.com', '主源'], ['security.ubuntu.com', '安全源']]) {
  for (const [name, corrupt] of [
    ['wrong URI', block => block.replace(`https://fast.thanejoss.com/${host}/ubuntu/`, `https://${host}/ubuntu/`)],
    ['outdated suites', block => block.replaceAll('noble', 'jammy')],
    ['disabled stanza', block => block.replace('Types: deb\n', 'Types: deb\nEnabled: no\n')],
    ['disabled after the closing marker', block => `${block}\nEnabled: no`],
  ]) {
    test(`repairs ${host} with ${name} despite unchanged version markers`, t => {
      const f = fixture(t);
      f.run();
      const original = contents(f.sources);
      const expected = sourceBlock(original, host);
      const damaged = corrupt(expected);
      assert.notEqual(damaged, expected);
      const thirdParty = 'Types: deb\nURIs: https://example.org/packages\nSuites: stable\nComponents: main\nSigned-By: /usr/share/keyrings/example.gpg\n';
      writeFileSync(f.sources, `${original.replace(expected, damaged)}\n${thirdParty}`);
      const output = f.run();
      assert.ok(output.includes(`[已修改] Ubuntu ${label}`), output);
      assert.equal(sourceBlock(contents(f.sources), host), expected);
      assert.ok(!contents(f.sources).includes('Enabled: no'));
      assert.ok(contents(f.sources).includes(thirdParty), 'unrelated deb822 stanza must survive repair');
      const repaired = unchangedSnapshot(f.sources);
      f.run();
      assertUnchanged(f.sources, repaired);
    });
  }
}

test('updates suites after an Ubuntu release change without a Worker version change', t => {
  const f = fixture(t);
  f.run();
  writeFileSync(f.release, 'ID=ubuntu\nVERSION_CODENAME=resolute\n');
  f.run();
  assert.match(sourceBlock(contents(f.sources), 'archive.ubuntu.com'), /Suites: resolute resolute-updates resolute-backports/);
  assert.match(sourceBlock(contents(f.sources), 'security.ubuntu.com'), /Suites: resolute-security/);
  assert.ok(!contents(f.sources).includes('noble'));
});

test('preserves npm config, permissions and symlink, and does not rewrite on repeat', t => {
  const f = fixture(t);
  const target = join(f.home, 'npm-config');
  writeFileSync(target, '# user settings\nregistry=https://registry.npmjs.org/\nfund=false\nregistry=https://example.org/\n');
  chmodSync(target, 0o640);
  symlinkSync(target, f.npmrc);
  const owner = statSync(target);
  f.run();
  assert.ok(lstatSync(f.npmrc).isSymbolicLink());
  assert.equal(contents(target), `# user settings\nregistry=${registry}\nfund=false\n`);
  assert.equal(statSync(target).mode & 0o777, 0o640);
  assert.equal(statSync(target).uid, owner.uid);
  assert.equal(statSync(target).gid, owner.gid);
  const before = unchangedSnapshot(target);
  assert.match(f.run(), /\[未修改\] npm registry/);
  assertUnchanged(target, before);
});
