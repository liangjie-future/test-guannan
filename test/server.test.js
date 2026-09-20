import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../src/server.js';

function tmpDataDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fp005-${label}-`));
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (server.listening) {
      server.closeIdleConnections();
      server.closeAllConnections();
    }
    server.close(() => resolve());
  });
}

async function startOnEphemeralPort(t, dataDir) {
  const handle = await startServer({ host: '127.0.0.1', port: 0, dataDir });
  t.after(() => closeServer(handle.server));
  return handle;
}

async function waitForRefused(url, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      assert.fail(`预期连接被拒，却得到了 ${res.status}`);
    } catch (err) {
      if (err instanceof assert.AssertionError) throw err;
      const reason = String(err.cause || err);
      if (/ECONNREFUSED|ECONNRESET|fetch failed/i.test(reason)) return;
      if (Date.now() > deadline) throw err;
    }
    if (Date.now() > deadline) assert.fail(`超 ${timeoutMs}ms 端口仍可连接: ${url}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('S1: GET / 返回 200 FP-004 页面骨架（统一布局）', async (t) => {
  const handle = await startOnEphemeralPort(t, tmpDataDir('home'));
  const res = await fetch(handle.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8/i);
  const body = await res.text();
  assert.match(body, /class="site-header"/);
  assert.match(body, /class="site-nav"/);
  assert.match(body, /class="site-footer"/);
  assert.ok(body.includes('页面骨架演示页'), '首页应为 FP-004 页面骨架而非占位页');
});

test('S2: HEAD / 返回 200 且无正文', async (t) => {
  const handle = await startOnEphemeralPort(t, tmpDataDir('head'));
  const res = await fetch(handle.url, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
});

test('S3: 未知路径返回 404', async (t) => {
  const handle = await startOnEphemeralPort(t, tmpDataDir('404'));
  const res = await fetch(new URL('/no-such-path', handle.url));
  assert.equal(res.status, 404);
});

test('S4: GET / 之外的方法返回 405（Allow: GET）', async (t) => {
  const handle = await startOnEphemeralPort(t, tmpDataDir('405'));
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = await fetch(handle.url, { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET');
  }
});

test('S5: 启动时自动创建 DATA_DIR（含多级不存在路径）', async (t) => {
  const base = tmpDataDir('mkdir');
  const nested = path.join(base, 'a', 'b', 'c');
  await startOnEphemeralPort(t, nested);
  assert.ok(fs.statSync(nested).isDirectory(), 'DATA_DIR 应被递归创建');
});

test('S6: 端口被占用时 startServer 以明确错误 reject', async (t) => {
  const first = await startOnEphemeralPort(t, tmpDataDir('busy-first'));
  await assert.rejects(
    startServer({
      host: '127.0.0.1',
      port: first.server.address().port,
      dataDir: tmpDataDir('busy-second'),
    }),
    /EADDRINUSE|listen/i,
  );
});

test('S7: 停止后端口释放，同端口再启动 GET / 仍 200', async () => {
  const dataDir = tmpDataDir('restart');
  const first = await startServer({ host: '127.0.0.1', port: 0, dataDir });
  const port = first.server.address().port;
  const url = first.url;
  assert.equal((await fetch(url)).status, 200);

  await closeServer(first.server);
  await waitForRefused(url);

  const second = await startServer({ host: '127.0.0.1', port, dataDir });
  try {
    assert.equal((await fetch(second.url)).status, 200);
  } finally {
    await closeServer(second.server);
  }
});
