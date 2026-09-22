import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import worker from '../index.js';

const origin = 'https://mirror.example:8443';
const registry = `${origin}/registry.npmjs.org/`;

async function requestScript({ enabled = true, method = 'GET', path = '/npm.sh' } = {}) {
  const events = [];
  const pending = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() { return { enabled: Number(enabled) }; },
            async run() { events.push({ sql, values }); },
          };
        },
      };
    },
  };
  const response = await worker.fetch(new Request(`${origin}${path}`, {
    method, headers: { 'CF-Connecting-IP': '192.0.2.10' },
  }), { DB, CF_VERSION_METADATA: { id: 'test-version' } }, {
    waitUntil(promise) { pending.push(promise); },
  });
  await Promise.all(pending);
  return { response, events };
}

test('npm setup uses the request origin and version and is logged behind the IP allowlist', async () => {
  const { response, events } = await requestScript();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const script = await response.text();
  assert.ok(script.includes(registry));
  assert.ok(script.includes('Version test-version'));
  assert.ok(!script.includes('__FAST_'));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].values.slice(1, 6), ['192.0.2.10', 'GET', '/npm.sh', 200, 'allowed']);

  const denied = await requestScript({ enabled: false });
  assert.equal(denied.response.status, 403);
  assert.equal(await denied.response.text(), '');
  assert.equal(denied.events[0].values[5], 'denied');
});

test('HEAD serves script headers without a body and the Ubuntu root script remains available', async () => {
  const { response } = await requestScript({ method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '');
  const root = await requestScript({ path: '/' });
  assert.match(await root.response.text(), /\/etc\/apt\/sources/);
});

test('setup configures only the user registry, is repeatable, and resets without losing other settings', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fast-npm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const userConfig = join(directory, 'user.npmrc');
  const globalConfig = join(directory, 'global.npmrc');
  const scriptFile = join(directory, 'npm.sh');
  const workspace = join(directory, 'packages', 'app');
  await mkdir(workspace, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'test-workspace', version: '1.0.0' }));
  const projectConfig = 'registry=https://project.example/\n';
  await writeFile(join(directory, '.npmrc'), projectConfig);
  await writeFile(userConfig, 'registry=https://previous.example/\n@private:registry=https://private.example/\n//private.example/:_authToken=fixture-token\n');
  const globalContents = 'registry=https://global.example/\n';
  await writeFile(globalConfig, globalContents);
  await writeFile(scriptFile, await (await requestScript()).response.text());

  // Keep all npm writes inside the fixture, even with global config enabled.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
  Object.assign(env, {
    NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_CACHE: join(directory, 'cache'), NPM_CONFIG_GLOBAL: 'true',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  });
  const run = (...args) => spawnSync('sh', [scriptFile, ...args], { cwd: workspace, env, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const configured = await readFile(userConfig, 'utf8');
  assert.ok(configured.includes(`registry=${registry}`));
  assert.ok(configured.includes('@private:registry=https://private.example/'));
  assert.ok(configured.includes('//private.example/:_authToken=fixture-token'));
  assert.equal(await readFile(globalConfig, 'utf8'), globalContents);
  assert.equal(await readFile(join(directory, '.npmrc'), 'utf8'), projectConfig);
  const repeated = run();
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(await readFile(userConfig, 'utf8'), configured);

  const reset = run('--reset');
  assert.equal(reset.status, 0, reset.stderr);
  const restored = await readFile(userConfig, 'utf8');
  assert.match(restored, /^registry=https:\/\/registry\.npmjs\.org\/$/m);
  assert.ok(restored.includes('//private.example/:_authToken=fixture-token'));
  for (const args of [['--unknown'], ['--reset', 'extra']]) {
    assert.equal(run(...args).status, 2);
    assert.equal(await readFile(userConfig, 'utf8'), restored);
  }
  assert.equal(run('--help').status, 0);
  assert.equal(await readFile(userConfig, 'utf8'), restored);
});

test('setup handles missing npm and reports npm failures', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fast-npm-errors-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scriptFile = join(directory, 'npm.sh');
  await writeFile(scriptFile, await (await requestScript()).response.text());
  const env = { ...process.env, PATH: directory };
  let result = spawnSync('/bin/sh', [scriptFile], { env, encoding: 'utf8' });
  assert.equal(result.status, 127);
  assert.match(result.stderr, /npm is not installed/);
  assert.equal(spawnSync('/bin/sh', [scriptFile, '--help'], { env }).status, 0);
  await writeFile(join(directory, 'npm'), '#!/bin/sh\nexit 42\n', { mode: 0o755 });
  result = spawnSync('/bin/sh', [scriptFile], { env, encoding: 'utf8' });
  assert.equal(result.status, 42);
  assert.equal(result.stdout, '');
});
