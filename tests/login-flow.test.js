import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import { createWebServer, startServer, webUsers } from '../src/server.js';
import { createSessionAccess } from '../src/session-access.js';
import { createMemorySessionStore } from '../src/session-store.js';
import { UNIFIED_LOGIN_ERROR_MESSAGE, createMockLoginService } from '../src/login-mock.js';

function createStack({ login = createMockLoginService() } = {}) {
  const store = createMemorySessionStore({ users: webUsers() });
  const sessionAccess = createSessionAccess({ store });
  const server = createWebServer({ sessionAccess, login });
  return { store, sessionAccess, server };
}

async function withServer(server, run) {
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

function postForm(base, body, extraHeaders = {}) {
  return fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders },
    body,
    redirect: 'manual',
  });
}

test('L1: 未登录 GET /login 呈现两输入 + 提交控件，导航为未登录态', async () => {
  const { server } = createStack();
  await withServer(server, async (base) => {
    const res = await fetch(`${base}/login`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8/);

    const html = await res.text();
    assert.match(html, /class="site-header"/, '应挂载统一布局');
    assert.match(html, /<form[^>]*method="post"[^>]*action="\/login"/);
    assert.match(html, /<input[^>]*type="text"[^>]*name="username"/);
    assert.match(html, /<input[^>]*type="password"[^>]*name="password"/);
    assert.match(html, /<button[^>]*type="submit"/);
    assert.match(html, /<button[^>]*type="button"[^>]*aria-pressed="false"[^>]*aria-controls="login-password">显示密码<\/button>/);
    assert.ok(html.includes('data-login-state="anonymous"'));
    assert.ok(html.includes('href="/login"'));
    assert.ok(html.includes('href="/register"'));
    assert.ok(!html.includes('href="/logout"'), '未登录不可见退出入口');
  });
});

test('L1a: 登录路由每次渲染均为默认隐藏，不影响注册页', async () => {
  const { server } = createStack();
  await withServer(server, async (base) => {
    const first = await (await fetch(`${base}/login`)).text();
    const second = await (await fetch(`${base}/login`)).text();
    assert.equal((first.match(/aria-pressed="false"/g) ?? []).length, 1);
    assert.equal((second.match(/aria-pressed="false"/g) ?? []).length, 1);

    const register = await (await fetch(`${base}/register`)).text();
    assert.ok(!register.includes('login-password'));
    assert.ok(!register.includes('显示密码'));
  });
});

test('L2: POST bob / right-password → 302 /timeline + 下发会话 Cookie', async () => {
  const { server } = createStack();
  await withServer(server, async (base) => {
    const res = await postForm(base, 'username=bob&password=right-password');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/timeline');

    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /session_token=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=[1-9]/);
  });
});

test('L3: 携登录 Cookie 访问 /timeline → 200 且导航显示 bob 与退出入口', async () => {
  const { server } = createStack();
  await withServer(server, async (base) => {
    const loginRes = await postForm(base, 'username=bob&password=right-password');
    const token = /session_token=([^;]+)/.exec(loginRes.headers.get('set-cookie') ?? '')?.[1];
    assert.ok(token, '应下发会话凭据');

    const res = await fetch(`${base}/timeline`, {
      headers: { cookie: `session_token=${token}` },
      redirect: 'manual',
    });
    assert.equal(res.status, 200, '登录态应放行受限页');

    const html = await res.text();
    assert.ok(html.includes('data-login-state="logged-in"'));
    assert.ok(html.includes('data-testid="current-username"'));
    assert.ok(html.includes('bob'));
    assert.ok(html.includes('href="/logout"'), '已登录可见退出入口');
  });
});

test('L4: 错误密码 → 200 统一错误提示，不下发 Cookie、不建会话', async () => {
  const { store, server } = createStack();
  await withServer(server, async (base) => {
    const res = await postForm(base, 'username=bob&password=wrong-password');
    assert.equal(res.status, 200);

    const html = await res.text();
    assert.ok(html.includes('data-testid="login-error"'));
    assert.ok(html.includes(UNIFIED_LOGIN_ERROR_MESSAGE));
    assert.match(html, /type="password"[^>]*id="login-password"/);
    assert.match(html, /aria-pressed="false"[^>]*aria-controls="login-password">显示密码/);
    assert.ok(!html.includes('value="bob"'), '失败态不应回填用户名');
    assert.ok(!html.includes('value="wrong-password"'), '失败态不应回填密码');
    assert.match(html, /<form[^>]*method="post"/, '失败后表单保留可重试');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(store.getSession('seed-token-1')?.user_id, 1, '种子会话不受影响');
  });
});

test('L5: 未知用户名 → 与错误密码文案逐字一致（不区分哪项错）', async () => {
  const { server } = createStack();
  await withServer(server, async (base) => {
    const byBadPassword = await postForm(base, 'username=bob&password=wrong-password');
    const byGhostUser = await postForm(base, 'username=ghost&password=right-password');

    for (const res of [byBadPassword, byGhostUser]) {
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('set-cookie'), null);
    }
    const extractError = (html) => /data-testid="login-error"[^>]*>([^<]+)</.exec(html)?.[1];
    const badPasswordHtml = await byBadPassword.text();
    const ghostUserHtml = await byGhostUser.text();
    assert.equal(extractError(ghostUserHtml), extractError(badPasswordHtml));
    assert.equal(extractError(badPasswordHtml), UNIFIED_LOGIN_ERROR_MESSAGE);
  });
});

test('L6: 空 / 缺字段 → 统一失败提示，不 500', async () => {
  const { server } = createStack();
  await withServer(server, async (base) => {
    for (const body of ['', 'username=&password=', 'username=bob']) {
      const res = await postForm(base, body);
      assert.equal(res.status, 200, `body=${body || '(空)'} 应回渲染`);
      const html = await res.text();
      assert.ok(html.includes('data-testid="login-error"'), `body=${body || '(空)'} 应有统一提示`);
    }
  });
});

test('L7: 超过上限的请求体 → 413', async () => {
  const { server } = createStack();
  await withServer(server, async (base) => {
    const res = await postForm(base, `username=${'x'.repeat(70 * 1024)}&password=y`);
    assert.equal(res.status, 413);
  });
});

test('L8: PUT /login → 405 且 Allow 含 POST', async () => {
  const { server } = createStack();
  await withServer(server, async (base) => {
    const res = await fetch(`${base}/login`, { method: 'PUT', redirect: 'manual' });
    assert.equal(res.status, 405);
    assert.match(res.headers.get('allow') ?? '', /POST/);
  });
});

test('L9/L10: 退出回路——logout 使 token 立即失效，导航回未登录态', async () => {
  const { store, server } = createStack();
  await withServer(server, async (base) => {
    const loginRes = await postForm(base, 'username=bob&password=right-password');
    const token = /session_token=([^;]+)/.exec(loginRes.headers.get('set-cookie') ?? '')?.[1];
    const cookie = `session_token=${token}`;
    assert.notEqual(store.getSession(token), null, '登录后应建会话');

    const logoutRes = await fetch(`${base}/logout`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(logoutRes.status, 302);
    assert.equal(logoutRes.headers.get('location'), '/login');
    assert.match(logoutRes.headers.get('set-cookie') ?? '', /Max-Age=0/);
    assert.equal(store.getSession(token), null, '退出后原 token 失效（logout 已被调用）');

    const timeline = await fetch(`${base}/timeline`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(timeline.status, 302, '退出后受限页视为未登录');
    assert.equal(timeline.headers.get('location'), '/login');

    const home = await fetch(`${base}/`, { headers: { cookie } });
    const html = await home.text();
    assert.ok(html.includes('data-login-state="anonymous"'), '导航回未登录态');
    assert.ok(!html.includes('href="/logout"'), '退出入口不再可见');
    assert.ok(!html.includes('data-testid="current-username"'), 'bob 不再呈现');
  });
});

test('L11: FP-004 基线（未注入 sessionAccess）POST 成功仅 302、GET 表单可达', async () => {
  const server = createWebServer();
  await withServer(server, async (base) => {
    const page = await fetch(`${base}/login`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<form[^>]*method="post"/);

    const res = await postForm(base, 'username=bob&password=right-password');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/timeline');
    assert.equal(res.headers.get('set-cookie'), null, '基线无会话层不下发 Cookie');

    const failed = await postForm(base, 'username=bob&password=nope');
    assert.equal(failed.status, 200);
    assert.ok((await failed.text()).includes('data-testid="login-error"'));
  });
});

test('L12: 生产组装（startServer 默认注入 bob 种子）登录态端到端贯通', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp008-prod-'));
  const handle = await startServer({ host: '127.0.0.1', port: 0, dataDir });
  t.after(() => serverClose(handle.server));

  const loginRes = await fetch(`${handle.url}login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=bob&password=right-password',
    redirect: 'manual',
  });
  assert.equal(loginRes.status, 302);
  const token = /session_token=([^;]+)/.exec(loginRes.headers.get('set-cookie') ?? '')?.[1];
  assert.ok(token);

  const res = await fetch(`${handle.url}timeline`, {
    headers: { cookie: `session_token=${token}` },
    redirect: 'manual',
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('data-login-state="logged-in"'));
  assert.ok(html.includes('bob'));
  assert.ok(html.includes('href="/logout"'));
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
