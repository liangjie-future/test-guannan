import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import { createWebServer, startServer } from '../src/server.js';
import { createSessionAccess } from '../src/session-access.js';
import { createMemorySessionStore } from '../src/session-store.js';
import { createMockRegisterService } from '../src/register-service.js';

function stubRegisterService(resultByKey, { throwForKey = null } = {}) {
  const calls = [];
  return {
    calls,
    async register(username, password) {
      calls.push({ username, password });
      if (throwForKey) throw throwForKey;
      return typeof resultByKey === 'function' ? resultByKey(username, password) : resultByKey;
    },
  };
}

async function withServer(deps, run) {
  const server = createWebServer(deps);
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

function postForm(base, fields, { body = null } = {}) {
  return fetch(`${base}/register`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body ?? new URLSearchParams(fields).toString(),
  });
}

function assertNoSuccessHints(response, html) {
  assert.equal(response.headers.get('set-cookie'), null, '失败态不得下发会话 Cookie');
  assert.ok(!html.includes('data-testid="register-success"'), '失败态不得有成功标记');
  assert.ok(!html.includes('注册成功'), '失败态不得出现成功文案');
}

test('R1: 注册页渲染用户名/密码输入与提交控件（统一布局、无初始错误）', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/register`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8/);
    const html = await res.text();
    assert.match(html, /class="site-header"/, '应挂载进 FP-004 统一布局');
    assert.match(html, /method="post"/);
    assert.match(html, /action="\/register"/);
    assert.ok(html.includes('name="username"'));
    assert.ok(html.includes('name="password"'));
    assert.match(html, /name="password"[^>]*type="password"|type="password"[^>]*name="password"/);
    assert.ok(html.includes('type="submit"'));
    assert.ok(!html.includes('data-testid="register-error"'), '初始渲染不应有错误横幅');
    assert.ok(!html.includes('data-testid="register-success"'));
    assertNoSuccessHints(res, html);

    const head = await fetch(`${base}/register`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});

test('R2: Mock 返回 OK（alice/secret123）→ 302 时间线 + 会话 Cookie，Mock 建号', async () => {
  const mock = createMockRegisterService();
  await withServer({ registerService: mock }, async (base) => {
    const res = await postForm(base, { username: 'alice', password: 'secret123' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/timeline');
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /session_token=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.ok(mock.hasUser('alice'), 'OK 态应建号');
  });
});

test('R3: Mock 返回 USERNAME_TAKEN（alice/任意）→ 提示用户名已存在，账号未创建', async () => {
  const mock = createMockRegisterService();
  await withServer({ registerService: mock }, async (base) => {
    const first = await postForm(base, { username: 'alice', password: 'secret123' });
    assert.equal(first.status, 302);

    const res = await postForm(base, { username: 'alice', password: 'whatever-long' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    const html = await res.text();
    assert.ok(html.includes('data-testid="register-error"'));
    assert.ok(html.includes('用户名已存在'), '应提示用户名已存在');
    assert.ok(html.includes('name="username"') && html.includes('type="submit"'), '表单应保留可重试');
    assertNoSuccessHints(res, html);
    assert.equal(mock.userCount(), 1, '失败不得再次建号');
  });
});

test('R4: Mock 返回 PASSWORD_TOO_SHORT（newuser/12345）→ 提示密码过短，账号未创建', async () => {
  const mock = createMockRegisterService();
  await withServer({ registerService: mock }, async (base) => {
    const res = await postForm(base, { username: 'newuser', password: '12345' });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('data-testid="register-error"'));
    assert.ok(html.includes('密码过短'), '应提示密码过短');
    assertNoSuccessHints(res, html);
    assert.ok(!mock.hasUser('newuser'), '过短失败不得建号');
    assert.equal(mock.userCount(), 0);
  });
});

test('R5: OK 后承接 FP-003 会话 → 时间线呈现已登录态与用户名标识', async () => {
  const sessionAccess = createSessionAccess({ store: createMemorySessionStore() });
  const registerService = createMockRegisterService({
    createSessionOnLogin: (userId) => sessionAccess.createSessionOnLogin(userId).token,
  });
  await withServer({ sessionAccess, registerService }, async (base) => {
    const res = await postForm(base, { username: 'alice', password: 'secret123' });
    assert.equal(res.status, 302);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    const timeline = await fetch(`${base}/timeline`, {
      redirect: 'manual',
      headers: { cookie },
    });
    assert.equal(timeline.status, 200, '有效会话应放行时间线');
    const html = await timeline.text();
    assert.ok(html.includes('data-login-state="logged-in"'), '应进入登录态');
    assert.ok(html.includes('data-testid="current-username"'));
    assert.ok(html.includes('alice'), '应显示注册用户名');
  });
});

test('R6: 用户名/密码缺失或乱码体 → 提示填写完备，服务不被调用', async () => {
  const stub = stubRegisterService({ status: 'OK', user: { id: 1, username: 'x' }, session_token: 't' });
  await withServer({ registerService: stub }, async (base) => {
    const cases = [
      { body: new URLSearchParams({ username: '', password: 'secret123' }).toString() },
      { body: new URLSearchParams({ username: 'newuser', password: '' }).toString() },
      { body: new URLSearchParams({}).toString() },
      { body: '%%%not-a-valid-form%%%' },
    ];
    for (const { body } of cases) {
      const res = await postForm(base, null, { body });
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('请填写用户名和密码'), '应提示字段缺失');
      assertNoSuccessHints(res, html);
    }
    assert.equal(stub.calls.length, 0, '字段缺失不得触达注册服务');
  });
});

test('R7: 失败重渲染回显用户名经转义（无反射 XSS）', async () => {
  const stub = stubRegisterService({ status: 'ERROR', reason: 'USERNAME_TAKEN' });
  await withServer({ registerService: stub }, async (base) => {
    const evil = '<script>alert("x")</script>';
    const res = await postForm(base, { username: evil, password: '12345' });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes(`<script>alert`), '不得回显未转义脚本');
    assert.ok(html.includes('&lt;script&gt;'), '应转义回显');
    assertNoSuccessHints(res, html);
  });
});

test('R8: 未知 reason → 兜底文案，不崩溃、无成功暗示', async () => {
  const stub = stubRegisterService({ status: 'ERROR', reason: 'SOMETHING_ELSE' });
  await withServer({ registerService: stub }, async (base) => {
    const res = await postForm(base, { username: 'whoever', password: 'secret123' });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('注册失败，请稍后重试'), '未知原因应给兜底文案');
    assertNoSuccessHints(res, html);
  });
});

test('R9: register 服务抛异常 → 500 纯文本，无成功暗示', async () => {
  const stub = stubRegisterService(null, { throwForKey: new Error('boom') });
  await withServer({ registerService: stub }, async (base) => {
    const res = await postForm(base, { username: 'whoever', password: 'secret123' });
    assert.equal(res.status, 500);
    assert.ok(!(res.headers.get('set-cookie') ?? '').includes('session_token'));
  });
});

test('R10: 生产组装 startServer → 注册成功即已登录（时间线显示用户名）', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp006-prod-'));
  const handle = await startServer({ host: '127.0.0.1', port: 0, dataDir });
  t.after(() => serverClose(handle.server));
  const res = await postForm(handle.url.replace(/\/$/, ''), { username: 'alice', password: 'secret123' });
  assert.equal(res.status, 302);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const timeline = await fetch(`${handle.url}timeline`, { redirect: 'manual', headers: { cookie } });
  assert.equal(timeline.status, 200);
  const html = await timeline.text();
  assert.ok(html.includes('data-login-state="logged-in"'));
  assert.ok(html.includes('alice'));
});

test('R11: POST 基线兼容 —— 非注册路由仍 405，注册页 Allow 含 POST', async () => {
  await withServer({}, async (base) => {
    const other = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual' });
    assert.equal(other.status, 405);
    const patch = await fetch(`${base}/register`, { method: 'PUT', redirect: 'manual' });
    assert.equal(patch.status, 405);
    assert.match(patch.headers.get('allow') ?? '', /POST/);
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
