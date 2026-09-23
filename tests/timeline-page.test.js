import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import { createWebServer, startServer } from '../src/server.js';
import { createSessionAccess } from '../src/session-access.js';
import { createMemorySessionStore } from '../src/session-store.js';
import { createMockGetTimeline } from '../src/timeline.js';

const aliceUser = () => ({ id: 1, username: 'alice' });
const anonymousUser = () => null;

function seededPosts() {
  const posts = createMockGetTimeline()(1);
  assert.equal(posts.length, 4);
  return posts;
}

async function withServer(options, run) {
  const server = createWebServer(options);
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

function orderedTimes(html) {
  return [...html.matchAll(/<time[^>]*datetime="([^"]*)"/g)].map((m) => m[1]);
}

test('H1: 基线模式已登录替身 + 场景 A：/timeline 200，统一布局，4 条倒序、字段齐全', async () => {
  await withServer(
    { getCurrentUser: aliceUser, getTimeline: createMockGetTimeline() },
    async (base) => {
      const res = await fetchNoRedirect(`${base}/timeline`);
      assert.equal(res.status, 200);
      const html = await res.text();

      assert.match(html, /class="site-header"/, '应经统一布局装配');
      assert.match(html, /class="site-footer"/);
      assert.ok(html.includes('<h1>时间线</h1>'));

      const items = html.match(/data-testid="timeline-item"/g) ?? [];
      assert.equal(items.length, 4, '条目数应与 Mock 一致');
      const posts = seededPosts();
      assert.deepEqual(orderedTimes(html), posts.map((p) => p.created_at), '顺序与服务返回一致');
      for (const post of posts) {
        assert.ok(html.includes(post.content), `缺少内容：${post.content}`);
        assert.ok(html.includes(`data-testid="post-author">${post.author_username}<`));
      }
    },
  );
});

test('H2: 基线模式场景 B：/timeline 显示空态提示与 /users 引导', async () => {
  await withServer(
    { getCurrentUser: aliceUser, getTimeline: createMockGetTimeline({ scenario: 'B' }) },
    async (base) => {
      const res = await fetchNoRedirect(`${base}/timeline`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('还没有关注任何人'));
      assert.ok(html.includes('href="/users"'));
      assert.equal((html.match(/data-testid="timeline-item"/g) ?? []).length, 0);
    },
  );
});

test('H3: 基线模式匿名直访 /timeline 200（FP-004 占位可达基线），渲染登录引导', async () => {
  await withServer(
    { getCurrentUser: anonymousUser, getTimeline: createMockGetTimeline() },
    async (base) => {
      const res = await fetchNoRedirect(`${base}/timeline`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('href="/login"'), '应引导登录');
      assert.ok(!html.includes('还没有关注任何人'), '匿名访客不应看到登录用户的空态语义');
    },
  );
});

test('H4: sessionAccess 模式匿名访问 /timeline 302 跳转 /login', async () => {
  const access = createSessionAccess({ store: createMemorySessionStore() });
  await withServer({ sessionAccess: access, getTimeline: createMockGetTimeline() }, async (base) => {
    const res = await fetchNoRedirect(`${base}/timeline`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
  });
});

test('H5: sessionAccess 模式已登录（alice）：200 帖子流，getTimeline 以 id=1 调用', async () => {
  const access = createSessionAccess({ store: createMemorySessionStore() });
  const { token } = access.createSessionOnLogin(1);
  const calls = [];
  const getTimeline = (user_id) => {
    calls.push(user_id);
    return createMockGetTimeline()(user_id);
  };
  await withServer({ sessionAccess: access, getTimeline }, async (base) => {
    const res = await fetchNoRedirect(`${base}/timeline`, {
      headers: { cookie: `session_token=${token}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal((html.match(/data-testid="timeline-item"/g) ?? []).length, 4);
    assert.deepEqual(calls, [1], '查询主体应为当前登录用户 id');
  });
});

test('H6: 默认落点——已登录 / 302 → /timeline；未登录 / 200 演示页', async () => {
  const access = createSessionAccess({ store: createMemorySessionStore() });
  const { token } = access.createSessionOnLogin(1);
  await withServer(
    { sessionAccess: access, getCurrentUser: anonymousUser, getTimeline: createMockGetTimeline() },
    async (base) => {
      const loggedIn = await fetchNoRedirect(base, {
        headers: { cookie: `session_token=${token}` },
      });
      assert.equal(loggedIn.status, 302);
      assert.equal(loggedIn.headers.get('location'), '/timeline');

      const anonymous = await fetchNoRedirect(base);
      assert.equal(anonymous.status, 200);
      assert.ok((await anonymous.text()).includes('页面骨架演示页'), '匿名首页保持 FP-004 基线');
    },
  );
});

test('H6b: 基线模式（无 sessionAccess）已登录替身 / 同样 302 → /timeline', async () => {
  await withServer({ getCurrentUser: aliceUser }, async (base) => {
    const res = await fetchNoRedirect(base);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/timeline');
  });
});

test('H7: 生产组装不预置种子会话，匿名访问 /timeline 仍受保护', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp014-prod-'));
  const handle = await startServer({ host: '127.0.0.1', port: 0, dataDir });
  t.after(() =>
    new Promise((resolve) => {
      handle.server.closeIdleConnections();
      handle.server.closeAllConnections();
      handle.server.close(() => resolve());
    }),
  );

  const anonymous = await fetchNoRedirect(`${handle.url}timeline`);
  assert.equal(anonymous.status, 302, '生产默认启用访问控制');
  assert.equal(anonymous.headers.get('location'), '/login');

  const seeded = await fetchNoRedirect(`${handle.url}timeline`, {
    headers: { cookie: 'session_token=seed-token-1' },
  });
  assert.equal(seeded.status, 302);
  assert.equal(seeded.headers.get('location'), '/login');
});

test('H8: POST /timeline 405（仅 GET/HEAD）', async () => {
  await withServer(
    { sessionAccess: createSessionAccess({ store: createMemorySessionStore() }) },
    async (base) => {
      const res = await fetchNoRedirect(`${base}/timeline`, {
        method: 'POST',
        headers: { cookie: 'session_token=seed-token-1' },
      });
      assert.equal(res.status, 405);
      assert.equal(res.headers.get('allow'), 'GET');
    },
  );
});
