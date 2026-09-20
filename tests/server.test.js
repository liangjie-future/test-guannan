import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createWebServer } from '../src/server.js';

const aliceUser = () => ({ id: 1, username: 'alice' });
const anonymousUser = () => null;

async function withServer(getCurrentUser, run) {
  const server = createWebServer({ getCurrentUser });
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

test('S1: 演示页 / 返回统一布局且五入口可达', async () => {
  await withServer(anonymousUser, async (base) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html; charset=utf-8/);

    const html = await response.text();
    assert.match(html, /class="site-header"/);
    assert.match(html, /class="site-nav"/);
    assert.match(html, /class="site-content"/);
    assert.match(html, /class="site-footer"/);
    assert.ok(html.includes('页面骨架演示页'));
    for (const href of ['/register', '/login', '/users', '/compose', '/timeline']) {
      assert.ok(html.includes(`href="${href}"`), `缺少导航入口 ${href}`);
    }
  });
});

test('S2: 剩余占位入口与 /logout 路由均以统一布局返回占位页（/register 已由 FP-006 真实页面替代）', async () => {
  await withServer(anonymousUser, async (base) => {
    const owners = {
      '/login': 'FP-008',
      '/users': 'FP-010',
      '/compose': 'FP-012',
      '/timeline': 'FP-014',
      '/logout': 'FP-003',
    };
    for (const [path, owner] of Object.entries(owners)) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, `${path} 应返回 200`);
      const html = await response.text();
      assert.match(html, /class="site-header"/, `${path} 应含页头导航`);
      assert.match(html, /class="site-footer"/, `${path} 应含页脚`);
      assert.ok(html.includes('布局骨架占位'), `${path} 应为占位内容区`);
      assert.ok(html.includes(owner), `${path} 占位应标注归属 ${owner}`);
    }

    const register = await fetch(`${base}/register`);
    assert.equal(register.status, 200);
    const registerHtml = await register.text();
    assert.ok(registerHtml.includes('name="username"'), '/register 应为真实注册表单');
    assert.ok(!registerHtml.includes('布局骨架占位'), '/register 不再是占位页');
  });
});

test('S3: 已登录替身（HTTP 层）导航含 alice 与退出入口', async () => {
  await withServer(aliceUser, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.includes('data-testid="current-username"'));
    assert.ok(html.includes('alice'));
    assert.ok(html.includes('已登录'));
    assert.ok(html.includes('href="/logout"'));
  });
});

test('S4: 未登录替身（HTTP 层）含注册/登录入口且无用户名与退出', async () => {
  await withServer(anonymousUser, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.includes('href="/register"'));
    assert.ok(html.includes('href="/login"'));
    assert.ok(!html.includes('data-testid="current-username"'));
    assert.ok(!html.includes('href="/logout"'));
    assert.ok(!html.includes('alice'));
  });
});

test('S5: 未知路径返回 404 且仍用统一布局', async () => {
  await withServer(anonymousUser, async (base) => {
    const response = await fetch(`${base}/no-such-page`);
    assert.equal(response.status, 404);
    const html = await response.text();
    assert.match(html, /class="site-header"/);
    assert.match(html, /class="site-footer"/);
    assert.ok(html.includes('页面未找到'));
  });
});
