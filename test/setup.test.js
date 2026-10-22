import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, lstatSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const template = readFileSync(join(project, 'setup.sh'), 'utf8');
const registry = 'https://fast.thanejoss.com/registry.npmjs.org/';
const version = 'test-version';
const account = userInfo();
const publicKey = template.match(/local key='([^']+)'/)[1];
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(t) {
  const root = mkdtempSync(join(project, '.setup-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const apt = join(root, 'etc/apt');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  for (const path of [join(apt, 'sources.list.d'), home, bin]) mkdirSync(path, { recursive: true });
  const release = join(root, 'etc/os-release');
  writeFileSync(release, 'ID=ubuntu\nVERSION_ID=24.04\nVERSION_CODENAME=noble\n');
  writeFileSync(join(apt, 'sources.list'), [
    'deb http://archive.ubuntu.com/ubuntu noble main restricted',
    'deb http://security.ubuntu.com/ubuntu noble-security main restricted',
    'deb https://example.org/packages stable main',
    '',
  ].join('\n'));
  writeFileSync(join(bin, 'getent'), `#!/bin/sh
[ "$1" != -- ] || shift
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
  for (const key of ['SUDO_USER', 'FAST_SSH_USER', 'BASH_ENV', 'ENV']) delete env[key];
  const sources = join(apt, 'sources.list.d/ubuntu.sources');
  const npmrc = join(home, '.npmrc');
  return {
    apt, home, release, sources, npmrc,
    backups() { return readdirSync(join(apt, 'fast-backups')).map(name => join(apt, 'fast-backups', name)); },
    run({ status = 0 } = {}) {
      const result = spawnSync('bash', ['--noprofile', '--norc', '-s'], { input: script, env, encoding: 'utf8' });
      assert.equal(result.error, undefined);
      assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`);
      return `${result.stdout}${result.stderr}`;
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
  const original = contents(join(f.apt, 'sources.list'));
  const thirdParty = join(f.apt, 'sources.list.d/vendor.list');
  writeFileSync(thirdParty, 'deb https://example.org/packages stable main\n');
  const vendorBefore = unchangedSnapshot(thirdParty);
  const first = f.run();
  assert.match(first, /\[已修改\] Ubuntu 主源/);
  assert.match(first, /\[已修改\] Ubuntu 安全源/);
  assert.match(first, /\[已修改\] npm registry/);
  assert.match(first.trimEnd().split('\n').at(-1), /^\[完成\]/);
  assert.match(sourceBlock(contents(f.sources), 'archive.ubuntu.com'), /URIs: https:\/\/fast\.thanejoss\.com\/archive\.ubuntu\.com\/ubuntu\//);
  assert.match(sourceBlock(contents(f.sources), 'security.ubuntu.com'), /Suites: noble-security/);
  assert.equal(contents(f.npmrc), `registry=${registry}\n`);
  assert.equal(statSync(f.npmrc).mode & 0o777, 0o600);
  assert.equal(existsSync(join(f.apt, 'sources.list')), false);
  assert.equal(f.backups().length, 1);
  assert.equal(contents(join(f.backups()[0], 'sources.list')), original);
  assertUnchanged(thirdParty, vendorBefore);
  const before = [f.sources, f.npmrc].map(path => [path, unchangedSnapshot(path)]);
  const second = f.run();
  assert.match(second, /\[未修改\] Ubuntu 主源/);
  assert.match(second, /\[未修改\] Ubuntu 安全源/);
  assert.match(second, /\[未修改\] npm registry/);
  assert.match(second.trimEnd().split('\n').at(-1), /^\[完成\]/);
  for (const [path, snapshot] of before) assertUnchanged(path, snapshot);
  assert.equal(f.backups().length, 1, 'repeat execution must not create another backup');
  assertUnchanged(thirdParty, vendorBefore);
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
      const damagedFile = `${original.replace(expected, damaged)}\n${thirdParty}`;
      writeFileSync(f.sources, damagedFile);
      const output = f.run();
      assert.ok(output.includes(`[已修改] Ubuntu ${label}`), output);
      assert.equal(sourceBlock(contents(f.sources), host), expected);
      assert.ok(!contents(f.sources).includes('Enabled: no'));
      assert.equal(contents(f.sources), original, 'canonical file is replaced in full');
      assert.ok(f.backups().some(path => existsSync(join(path, 'ubuntu.sources')) && contents(join(path, 'ubuntu.sources')) === damagedFile), 'the complete previous file must be backed up');
      const backups = f.backups();
      const repaired = unchangedSnapshot(f.sources);
      f.run();
      assertUnchanged(f.sources, repaired);
      assert.deepEqual(f.backups(), backups);
    });
  }
}

test('updates suites after an Ubuntu release change without a Worker version change', t => {
  const f = fixture(t);
  f.run();
  writeFileSync(f.release, 'ID=ubuntu\nVERSION_ID=26.04\nVERSION_CODENAME=resolute\n');
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

for (const [release, modern] of [['22.04', false], ['24.03', false], ['24.04', true]]) {
  test(`Ubuntu ${release} selects its source format and backs up both canonical files`, t => {
    const f = fixture(t);
    writeFileSync(f.release, `ID=ubuntu\nVERSION_ID=${release}\nVERSION_CODENAME=noble\n`);
    const legacy = join(f.apt, 'sources.list');
    const previousLegacy = contents(legacy);
    writeFileSync(f.sources, '# previous deb822 configuration\n');
    chmodSync(f.sources, 0o640);
    f.run();
    const target = modern ? f.sources : legacy;
    assert.equal(existsSync(modern ? legacy : f.sources), false);
    assert.equal(statSync(target).mode & 0o777, 0o644);
    if (modern) {
      assert.match(contents(target), /^Types: deb$/m);
    } else {
      assert.match(contents(target), /^deb \[signed-by=.*\] https:\/\/fast\.thanejoss\.com\/archive\.ubuntu\.com\/ubuntu\/ noble main/m);
      assert.match(contents(target), /^deb .* noble-security main/m);
      assert.doesNotMatch(contents(target), /^Types:/m);
    }
    assert.equal(f.backups().length, 1);
    assert.equal(contents(join(f.backups()[0], 'sources.list')), previousLegacy);
    assert.equal(contents(join(f.backups()[0], 'ubuntu.sources')), '# previous deb822 configuration\n');
    assert.equal(statSync(join(f.backups()[0], 'ubuntu.sources')).mode & 0o777, 0o640);
  });
}

test('replaces a canonical symlink without changing its destination and backs up the link', t => {
  const f = fixture(t);
  const destination = join(f.home, 'original.sources');
  writeFileSync(destination, '# preserve the symlink destination\n');
  symlinkSync(destination, f.sources);
  const before = unchangedSnapshot(destination);
  f.run();
  assert.equal(lstatSync(f.sources).isSymbolicLink(), false);
  assertUnchanged(destination, before);
  assert.ok(lstatSync(join(f.backups()[0], 'ubuntu.sources')).isSymbolicLink());
  assert.equal(contents(join(f.backups()[0], 'ubuntu.sources')), contents(destination));
});

for (const release of [
  'ID=debian\nVERSION_ID=12.0\nVERSION_CODENAME=bookworm\n',
  'ID=ubuntu\nVERSION_CODENAME=noble\n',
  'ID=ubuntu\nVERSION_ID=24.04\nVERSION_CODENAME=../invalid\n',
]) {
  test(`invalid Ubuntu release fails before changing source or user files: ${release.replaceAll('\n', '; ')}`, t => {
    const f = fixture(t);
    writeFileSync(f.release, release);
    const legacy = join(f.apt, 'sources.list');
    const before = unchangedSnapshot(legacy);
    assert.match(f.run({ status: 1 }), /\[错误\] Ubuntu/);
    assertUnchanged(legacy, before);
    assert.equal(existsSync(f.sources), false);
    assert.equal(existsSync(f.npmrc), false);
    assert.equal(existsSync(join(f.apt, 'fast-backups')), false);
    assert.deepEqual(readdirSync(f.home), []);
  });
}

test('SSH appends a key after an unterminated line, then preserves the file on repeat', { skip: account.uid === 0 && 'SSH intentionally skips direct root execution' }, t => {
  const f = fixture(t);
  const ssh = join(f.home, '.ssh');
  const keys = join(ssh, 'authorized_keys');
  mkdirSync(ssh, { mode: 0o755 });
  writeFileSync(keys, '# retained comment', { mode: 0o644 });
  f.run();
  assert.equal(contents(keys), `# retained comment\n${publicKey}\n`);
  assert.equal(statSync(ssh).mode & 0o777, 0o700);
  assert.equal(statSync(keys).mode & 0o777, 0o600);
  const before = unchangedSnapshot(keys);
  assert.match(f.run(), /\[未修改\] SSH authorized_keys/);
  assertUnchanged(keys, before);
});

test('SSH preserves restrictions on an already authorized key', { skip: account.uid === 0 && 'SSH intentionally skips direct root execution' }, t => {
  const f = fixture(t);
  const ssh = join(f.home, '.ssh');
  const keys = join(ssh, 'authorized_keys');
  mkdirSync(ssh, { mode: 0o700 });
  writeFileSync(keys, `restrict,command="echo hello" ${publicKey} existing\n`, { mode: 0o600 });
  const before = unchangedSnapshot(keys);
  assert.match(f.run(), /\[未修改\] SSH authorized_keys/);
  assertUnchanged(keys, before);
});

test('SSH refuses a symlinked authorized_keys without modifying its destination', { skip: account.uid === 0 && 'SSH intentionally skips direct root execution' }, t => {
  const f = fixture(t);
  const ssh = join(f.home, '.ssh');
  const destination = join(f.home, 'keys');
  mkdirSync(ssh, { mode: 0o700 });
  writeFileSync(destination, '# do not modify\n');
  symlinkSync(destination, join(ssh, 'authorized_keys'));
  const before = unchangedSnapshot(destination);
  assert.match(f.run({ status: 1 }), /\[错误\] SSH：authorized_keys/);
  assertUnchanged(destination, before);
});
