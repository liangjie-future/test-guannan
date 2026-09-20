import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import { createWebServer, startServer } from '../src/server.js';
import { createSessionAccess } from '../src/session-access.js';
import { createMemorySessionStore } from '../src/session-store.js';

const RESTRICTED_PATHS = ['/users', '/compose', '/timeline'];
const UNRESTRICTED_PATHS = ['/', '/login', '/register'];

function createAccess() {
  const store = createMemorySessionStore();
  const access = createSessionAccess({ store });
  return { store, access };
}

async function withServer(sessionAccess, run) {
  const server = createWebServer(sessionAccess ? { sessionAccess } : {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function fetchNoRedirect(url, options = {}) {
  return fetch(url, { ...options, redirect: 'manual' });
}

test('H1: 匿名访问受限页各自 302 跳转登录页（不放行、不 403）', async () => {
  const { access } = createAccess();
  await withServer(access, async (base) => {
    for (const page of RESTRICTED_PATHS) {
      const res = await fetchNoRedirect(`${base}${page}`);
      assert.equal(res.status, 302, `${page} 应 302`);
      assert.equal(res.headers.get('location'), '/login', `${page} 应跳转 /login`);
    }
  });
});

test('H2: 过期种子凭据访问受限页 302 跳转登录页', async () => {
  const { access } = createAccess();
  await withServer(access, async (base) => {
    const res = await fetchNoRedirect(`${base}/users`, {
      headers: { cookie: 'session_token=seed-token-expired' },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
  });
});

test('H3: 有效凭据访问受限三页 200 且布局显示 alice 已登录', async () => {
  const { access } = createAccess();
  const { token } = access.createSessionOnLogin(1);
  await withServer(access, async (base) => {
    for (const page of RESTRICTED_PATHS) {
      const res = await fetchNoRedirect(`${base}${page}`, {
        headers: { cookie: `session_token=${token}` },
      });
      assert.equal(res.status, 200, `${page} 应 200`);
      const html = await res.text();
      assert.match(html, /class="site-header"/, `${page} 应为统一布局`);
      assert.ok(html.includes('data-login-state="logged-in"'), `${page} 应已登录态`);
    }
  });
});

test('H4: 未受限页（首页 / 注册 / 登录）匿名可访问 200', async () => {
  const { access } = createAccess();
  await withServer(access, async (base) => {
    for (const page of UNRESTRICTED_PATHS) {
      const res = await fetchNoRedirect(`${base}${page}`);
      assert.equal(res.status, 200, `${page} 应 200`);
    }
  });
});

test('H5: logout 销毁会话并清除 Cookie，原凭据随即失效', async () => {
  const { access } = createAccess();
  const { token } = access.createSessionOnLogin(1);
  const cookie = `session_token=${token}`;
  await withServer(access, async (base) => {
    const loggedOut = await fetchNoRedirect(`${base}/logout`, { headers: { cookie } });
    assert.equal(loggedOut.status, 302);
    assert.equal(loggedOut.headers.get('location'), '/login');
    assert.match(loggedOut.headers.get('set-cookie') ?? '', /Max-Age=0/);

    const after = await fetchNoRedirect(`${base}/users`, { headers: { cookie } });
    assert.equal(after.status, 302, '销毁后的原凭据应视为未登录');
    assert.equal(after.headers.get('location'), '/login');
  });
});

test('H6: 匿名 logout 幂等（仅跳转，不报错）', async () => {
  const { access } = createAccess();
  await withServer(access, async (base) => {
    const res = await fetchNoRedirect(`${base}/logout`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
  });
});

test('H7: 生产组装（startServer 默认注入）匿名受限页 302、首页 200', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp003-prod-'));
  const handle = await startServer({ host: '127.0.0.1', port: 0, dataDir });
  t.after(() => serverClose(handle.server));
  const res = await fetchNoRedirect(`${handle.url}users`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  assert.equal((await fetchNoRedirect(handle.url)).status, 200);
});

test('H8: 登录态贯通布局：受限页含当前用户名标识与退出入口', async () => {
  const { access } = createAccess();
  const { token } = access.createSessionOnLogin(1);
  await withServer(access, async (base) => {
    const html = await (
      await fetchNoRedirect(`${base}/timeline`, {
        headers: { cookie: `session_token=${token}` },
      })
    ).text();
    assert.ok(html.includes('data-testid="current-username"'));
    assert.ok(html.includes('alice'));
    assert.ok(html.includes('href="/logout"'));
  });
});

test('H9: 未注入 sessionAccess 的 FP-004 基线：受限占位页匿名仍 200', async () => {
  await withServer(null, async (base) => {
    for (const page of RESTRICTED_PATHS) {
      const res = await fetchNoRedirect(`${base}${page}`);
      assert.equal(res.status, 200, `${page} 应保持占位可达`);
    }
  });
});

function serverClose(server) {
  return new Promise((resolve) => {
    if (server.listening) {
      server.closeIdleConnections();
      server.closeAllConnections();
    }
    server.close(() => resolve());
  });
}
