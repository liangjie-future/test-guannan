import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUN = path.join(ROOT, 'run');

function temporaryDirectory(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fp004-${label}-`));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitForExit(child, timeoutMs = 8000) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('managed process did not exit')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForReady(url, child, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`service exited before ready (code=${child.exitCode})`);
    }
    try {
      const response = await fetch(`${url}/`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch {
      // The listener may not have started yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`service was not ready within ${timeoutMs}ms`);
}

async function waitForRefused(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${url}/`, { redirect: 'manual' });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`port remained reachable: ${url}`);
}

function launch(kind, { dataDir, port, pythonBin } = {}) {
  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: dataDir,
    ...(pythonBin ? { PYTHON_BIN: pythonBin } : {}),
  };
  const command = kind === 'npm'
    ? ['npm', ['start']]
    : ['bash', [RUN, 'start', '--foreground']];
  const child = spawn(command[0], command[1], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return {
    child,
    url: `http://127.0.0.1:${port}`,
    output: () => `${stdout}\n${stderr}`,
  };
}

async function stopManaged(handle) {
  if (handle?.child.exitCode === null) {
    handle.child.kill('SIGTERM');
    await waitForExit(handle.child);
  }
  if (handle) await waitForRefused(handle.url);
}

async function startManaged(kind, options) {
  const handle = launch(kind, options);
  try {
    await waitForReady(handle.url, handle.child);
    return handle;
  } catch (error) {
    await waitForExit(handle.child).catch(() => {});
    throw new Error(`${error.message}\n${handle.output()}`);
  }
}

function cookieFrom(response) {
  const value = response.headers.get('set-cookie') ?? '';
  const match = /(?:^|,?\s*)session_token=([^;]+)/.exec(value);
  assert.ok(match, `response did not set session cookie: ${value}`);
  return decodeURIComponent(match[1]);
}

function cookieHeader(token) {
  return { cookie: `session_token=${token}` };
}

async function request(base, pathname, { token, method = 'GET', form, redirect = 'manual' } = {}) {
  const headers = token ? cookieHeader(token) : {};
  const options = { method, headers, redirect };
  if (form !== undefined) {
    options.body = new URLSearchParams(form);
    options.headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  return fetch(`${base}${pathname}`, options);
}

async function register(base, username) {
  const response = await request(base, '/register', {
    method: 'POST',
    form: { username, password: `${username}-password` },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/timeline');
  const cookie = response.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=\d+/);
  return cookieFrom(response);
}

async function publish(base, token, content) {
  return request(base, '/compose', { token, method: 'POST', form: { content } });
}

async function follow(base, token, id) {
  return request(base, `/users/${id}/follow`, { token, method: 'POST' });
}

async function exerciseBusinessFlow(kind) {
  const root = temporaryDirectory(`${kind}-data`);
  const dataDir = path.join(root, 'data');
  const port = await freePort();
  let handle = await startManaged(kind, { dataDir, port });
  try {
    const alice = await register(handle.url, 'alice');
    const bob = await register(handle.url, 'bob');
    const carol = await register(handle.url, 'carol');

    const users = await request(handle.url, '/users', { token: alice });
    const usersHtml = await users.text();
    assert.equal(users.status, 200);
    assert.match(usersHtml, /alice/);
    assert.match(usersHtml, /bob/);
    assert.match(usersHtml, /carol/);
    assert.match(usersHtml, /data-self="true"/);

    const selfFollow = await follow(handle.url, alice, 1);
    assert.equal(selfFollow.status, 303);
    assert.match(selfFollow.headers.get('location'), /SELF_FOLLOW_NOT_ALLOWED/);
    assert.equal((await follow(handle.url, alice, 2)).status, 303);
    assert.equal((await follow(handle.url, alice, 2)).status, 303);
    assert.equal((await follow(handle.url, bob, 3)).status, 303);

    assert.equal((await publish(handle.url, alice, 'alice own post')).status, 200);
    assert.equal((await publish(handle.url, bob, 'bob old post')).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await publish(handle.url, bob, 'bob new post')).status, 200);
    assert.equal((await publish(handle.url, carol, 'carol hidden post')).status, 200);

    const empty = await publish(handle.url, alice, ' \n\t ');
    assert.equal(empty.status, 200);
    assert.match(await empty.text(), /data-reason="EMPTY_CONTENT"/);
    const exact = await publish(handle.url, alice, '𝕒'.repeat(280));
    assert.equal(exact.status, 200);
    assert.match(await exact.text(), /data-result="OK"/);
    const tooLong = await publish(handle.url, alice, '𝕒'.repeat(281));
    assert.equal(tooLong.status, 200);
    assert.match(await tooLong.text(), /data-reason="TOO_LONG"/);

    const timeline = await request(handle.url, '/timeline', { token: alice });
    const timelineHtml = await timeline.text();
    assert.equal(timeline.status, 200);
    assert.match(timelineHtml, /bob new post/);
    assert.match(timelineHtml, /bob old post/);
    assert.doesNotMatch(timelineHtml, /alice own post/);
    assert.doesNotMatch(timelineHtml, /carol hidden post/);
    assert.ok(timelineHtml.indexOf('bob new post') < timelineHtml.indexOf('bob old post'));

    const home = await request(handle.url, '/', { token: alice });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get('location'), '/timeline');
    assert.equal(fs.existsSync(path.join(dataDir, 'social.db')), true);

    const oldToken = alice;
    await stopManaged(handle);
    handle = await startManaged(kind, { dataDir, port });
    const restoredTimeline = await request(handle.url, '/timeline', { token: oldToken });
    const restoredHtml = await restoredTimeline.text();
    assert.equal(restoredTimeline.status, 200);
    assert.match(restoredHtml, /bob new post/);
    assert.equal((await request(handle.url, '/users', { token: oldToken })).status, 200);

    const logout = await request(handle.url, '/logout', { token: oldToken });
    assert.equal(logout.status, 302);
    assert.equal(logout.headers.get('location'), '/login');
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    const invalidAfterLogout = await request(handle.url, '/timeline', { token: oldToken });
    assert.equal(invalidAfterLogout.status, 302);
    assert.equal(invalidAfterLogout.headers.get('location'), '/login');

    await stopManaged(handle);
    handle = await startManaged(kind, { dataDir, port });
    const invalidAfterRestart = await request(handle.url, '/timeline', { token: oldToken });
    assert.equal(invalidAfterRestart.status, 302);
    assert.equal(invalidAfterRestart.headers.get('location'), '/login');
  } finally {
    await stopManaged(handle).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('FP-004 real HTTP flow through npm start', { timeout: 60000 }, () => exerciseBusinessFlow('npm'));
test('FP-004 real HTTP flow through run foreground entry', { timeout: 60000 }, () => exerciseBusinessFlow('run'));

async function createFaultWorker(mode) {
  const directory = temporaryDirectory(`fault-${mode}`);
  const worker = path.join(directory, 'python-bin');
  const source = `#!/usr/bin/env python3
if ${JSON.stringify(mode)} == 'timeout':
    import time
    time.sleep(6)
elif ${JSON.stringify(mode)} == 'protocol':
    print('not-json')
else:
    raise SystemExit(9)
`;
  fs.writeFileSync(worker, source, { mode: 0o755 });
  return { directory, worker };
}

test('FP-004 missing Python executable fails startup without listening', { timeout: 15000 }, async () => {
  const parent = temporaryDirectory('missing-python');
  const dataDir = path.join(parent, 'data');
  const port = await freePort();
  const handle = launch('npm', { dataDir, port, pythonBin: path.join(dataDir, 'does-not-exist') });
  try {
    const result = await waitForExit(handle.child);
    assert.notEqual(result.code, 0);
    await waitForRefused(handle.url);
    assert.doesNotMatch(handle.output(), /password|session_token/i);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

for (const mode of ['process', 'timeout', 'protocol']) {
  test(`FP-004 ${mode} Python bridge fault is explicit`, { timeout: 20000 }, async () => {
    const dataDir = path.join(temporaryDirectory(`bridge-${mode}`), 'data');
    const { directory, worker: pythonBin } = await createFaultWorker(mode);
    const port = await freePort();
    const handle = launch('npm', { dataDir, port, pythonBin });
    try {
      const result = await waitForExit(handle.child);
      assert.notEqual(result.code, 0, handle.output());
      await waitForRefused(handle.url);
      assert.doesNotMatch(handle.output(), /password|session_token|at File|Traceback/i);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('FP-004 corrupted SQLite file fails startup rather than falling back', { timeout: 15000 }, async () => {
  const parent = temporaryDirectory('corrupt-db');
  const dataDir = path.join(parent, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'social.db'), 'not a sqlite database');
  const port = await freePort();
  const handle = launch('npm', { dataDir, port });
  try {
    const result = await waitForExit(handle.child);
    assert.notEqual(result.code, 0);
    await waitForRefused(handle.url);
    assert.doesNotMatch(handle.output(), /password|session_token|Traceback/i);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
