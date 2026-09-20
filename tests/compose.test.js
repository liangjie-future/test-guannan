import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createWebServer } from '../src/server.js';
import { createComposePage } from '../src/compose.js';
import {
  createMockPostService,
  countCodePoints,
} from '../src/post-service.js';
import { createSessionAccess } from '../src/session-access.js';
import { createMemorySessionStore } from '../src/session-store.js';

const aliceUser = () => ({ id: 1, username: 'alice' });
const anonymousUser = () => null;

const S280 = 'y'.repeat(280);
const S281 = 'x'.repeat(281);
const ASTRAL_141 = '𝕒'.repeat(141);
const ASTRAL_281 = '𝕒'.repeat(281);

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

function postContent(base, content, headers = {}) {
  return fetch(`${base}/compose`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ content }),
    redirect: 'manual',
  });
}

/* ---------- Mock 契约（任务卡 §3.2 / §6） ---------- */

test('M1: Mock 三态契约——hello world(11 字) → OK 且 post 字段齐全', () => {
  const svc = createMockPostService({ now: () => '2026-01-01T00:00:00.000Z' });
  const result = svc.createPost(1, 'hello world');
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.post, {
    id: 1,
    author_id: 1,
    content: 'hello world',
    created_at: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(svc.posts.length, 1);
});

test('M2: Mock 空态——"" 与 "   " 均 EMPTY_CONTENT 且不落帖', () => {
  for (const empty of ['', '   ']) {
    const svc = createMockPostService();
    const result = svc.createPost(1, empty);
    assert.deepEqual(result, { status: 'ERROR', reason: 'EMPTY_CONTENT' });
    assert.equal(svc.posts.length, 0, '空态不应落帖');
  }
});

test('M3: Mock 边界——281 字 TOO_LONG，恰 280 字 OK（上限含边界）', () => {
  const tooLong = createMockPostService().createPost(1, S281);
  assert.deepEqual(tooLong, { status: 'ERROR', reason: 'TOO_LONG' });

  const svc = createMockPostService();
  const ok = svc.createPost(1, S280);
  assert.equal(ok.status, 'OK');
  assert.equal(ok.post.content, S280);
  assert.equal(svc.posts.length, 1);
});

test('M4: 字数口径=码点——141 个非 BMP 字符(282 UTF-16 单元) OK，281 个 TOO_LONG', () => {
  const ok = createMockPostService().createPost(1, ASTRAL_141);
  assert.equal(ok.status, 'OK', '码点 141 ≤ 280 应通过（UTF-16 单元口径会误判超长）');

  const tooLong = createMockPostService().createPost(1, ASTRAL_281);
  assert.equal(tooLong.reason, 'TOO_LONG');
});

test('M5: Mock 失败路径 posts 恒不增长；非字符串 content 抛 TypeError', () => {
  const svc = createMockPostService();
  svc.createPost(1, S281);
  svc.createPost(1, '   ');
  assert.equal(svc.posts.length, 0);
  assert.throws(() => svc.createPost(1, null), TypeError);
});

test('M6: countCodePoints——空=0、ASCII=长度、代理对计 1', () => {
  assert.equal(countCodePoints(''), 0);
  assert.equal(countCodePoints('hello'), 5);
  assert.equal(countCodePoints('a𝕒b'), 3);
  assert.equal(countCodePoints(ASTRAL_141), 141);
});

test('M7: createComposePage 未注入 createPost 时 fail-fast', () => {
  assert.throws(() => createComposePage({}), /createPost/);
});

/* ---------- 界面渲染（HTTP 层，currentUser 替身=alice） ---------- */

test('C1: alice GET /compose——文本输入 + 发布控件 + 字数提示 0 / 280（统一布局内）', async () => {
  await withServer({ getCurrentUser: aliceUser }, async (base) => {
    const res = await fetch(`${base}/compose`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8/);

    const html = await res.text();
    assert.match(html, /class="site-header"/, '应挂载进统一布局');
    assert.match(html, /class="site-footer"/, '应挂载进统一布局');
    assert.ok(html.includes('<h1>发帖</h1>'));
    assert.ok(
      html.includes('<textarea') && html.includes('name="content"'),
      '应含纯文本输入',
    );
    assert.ok(html.includes('data-testid="compose-content"'));
    assert.ok(html.includes('data-testid="compose-form"'));
    assert.ok(html.includes('method="post"'));
    assert.ok(html.includes('action="/compose"'));
    assert.ok(
      html.includes('data-testid="publish-button"') && html.includes('发布'),
      '应含发布控件',
    );
    assert.ok(
      html.includes('data-testid="char-counter"') && html.includes('>0 / 280<'),
      '应含字数提示 当前 / 280',
    );
  });
});

test('C8: 实时字数机制——input 监听脚本随表单下发，初值来自服务端计数', async () => {
  await withServer({ getCurrentUser: aliceUser }, async (base) => {
    const html = await (await fetch(`${base}/compose`)).text();
    assert.ok(
      html.includes("addEventListener('input'"),
      '应含 input 事件监听脚本（实时更新）',
    );
    assert.ok(html.includes('data-max="280"'));
    assert.ok(html.includes('data-count="0"'));
  });
});

test('C2: 提交 hello world → Mock OK → 发布成功反馈且已落帖', async () => {
  const svc = createMockPostService();
  await withServer(
    { getCurrentUser: aliceUser, createPost: svc.createPost },
    async (base) => {
      const res = await postContent(base, 'hello world');
      assert.equal(res.status, 200);

      const html = await res.text();
      assert.ok(html.includes('data-result="OK"'));
      assert.ok(html.includes('发布成功'));
      assert.ok(html.includes('hello world'));

      assert.equal(svc.posts.length, 1);
      assert.equal(svc.posts[0].author_id, 1);
      assert.equal(svc.posts[0].content, 'hello world');
    },
  );
});

test('C5: 提交恰 280 字 → 发布成功（上限内 OK 态）', async () => {
  const svc = createMockPostService();
  await withServer(
    { getCurrentUser: aliceUser, createPost: svc.createPost },
    async (base) => {
      const html = await (await postContent(base, S280)).text();
      assert.ok(html.includes('data-result="OK"'));
      assert.ok(html.includes('发布成功'));
      assert.equal(svc.posts.length, 1);
      assert.equal(svc.posts[0].content, S280);
    },
  );
});

test('C3: 提交 281 字 → TOO_LONG 原因提示，帖子未发布且输入保留', async () => {
  const svc = createMockPostService();
  await withServer(
    { getCurrentUser: aliceUser, createPost: svc.createPost },
    async (base) => {
      const html = await (await postContent(base, S281)).text();
      assert.ok(html.includes('data-result="ERROR"'));
      assert.ok(html.includes('data-reason="TOO_LONG"'));
      assert.ok(html.includes('超过 280 字上限'));
      assert.ok(html.includes('当前 281 字'));
      assert.ok(html.includes(S281), '失败后应回显保留原输入');

      assert.equal(svc.posts.length, 0, '超长帖子未发布（Mock 不落帖）');
    },
  );
});

test('C4: 提交空串与全空白 → EMPTY_CONTENT 原因提示，帖子未发布', async () => {
  for (const empty of ['', '   ']) {
    const svc = createMockPostService();
    await withServer(
      { getCurrentUser: aliceUser, createPost: svc.createPost },
      async (base) => {
        const html = await (await postContent(base, empty)).text();
        assert.ok(html.includes('data-result="ERROR"'));
        assert.ok(html.includes('data-reason="EMPTY_CONTENT"'));
        assert.ok(html.includes('内容为空'));
        assert.ok(html.includes('帖子未发布'));

        assert.equal(svc.posts.length, 0, '空内容帖子未发布');
      },
    );
  }
});

test('C6: 失败重渲染计数与输入同步——281 字回显 281 / 280（码点口径）', async () => {
  const svc = createMockPostService();
  await withServer(
    { getCurrentUser: aliceUser, createPost: svc.createPost },
    async (base) => {
      const ascii = await (await postContent(base, S281)).text();
      assert.ok(ascii.includes('>281 / 280<'), '服务端预置计数应与输入同步');

      const astral = await (await postContent(base, ASTRAL_281)).text();
      assert.ok(
        astral.includes('>281 / 280<'),
        '281 个非 BMP 字符（562 个 UTF-16 单元）应按码点计 281',
      );
      assert.ok(astral.includes('data-reason="TOO_LONG"'));
    },
  );
});

test('C7: XSS——成功摘要与失败回显均转义，无原始注入', async () => {
  const svc = createMockPostService();
  await withServer(
    { getCurrentUser: aliceUser, createPost: svc.createPost },
    async (base) => {
      const successHtml = await (
        await postContent(base, '<script>alert(1)</script>')
      ).text();
      assert.ok(successHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
      assert.ok(!successHtml.includes('<script>alert(1)</script>'));

      const payload = `<img src=x onerror=alert(1)>${'x'.repeat(280)}`;
      const failureHtml = await (await postContent(base, payload)).text();
      assert.ok(failureHtml.includes('data-reason="TOO_LONG"'));
      assert.ok(failureHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
      assert.ok(!failureHtml.includes('<img src=x onerror=alert(1)>'));
    },
  );
});

/* ---------- 登录门槛（FP-003 挂载） ---------- */

test('G1: 会话态贯通——有效凭据 POST 发帖成功（author=alice）', async () => {
  const access = createSessionAccess({ store: createMemorySessionStore() });
  const { token } = access.createSessionOnLogin(1);
  const svc = createMockPostService();
  await withServer(
    { sessionAccess: access, createPost: svc.createPost },
    async (base) => {
      const res = await postContent(base, 'hello world', {
        cookie: `session_token=${token}`,
      });
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('data-result="OK"'));
      assert.equal(svc.posts.length, 1);
      assert.equal(svc.posts[0].author_id, 1);
    },
  );
});

test('G2: 匿名 POST /compose → 302 /login，不触达发帖服务', async () => {
  const access = createSessionAccess({ store: createMemorySessionStore() });
  const svc = createMockPostService();
  await withServer(
    { sessionAccess: access, createPost: svc.createPost },
    async (base) => {
      const res = await postContent(base, 'hello world');
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
      assert.equal(svc.posts.length, 0, '匿名提交不应触达发帖服务');
    },
  );
});

test('G3: 基线兼容——未注入会话时匿名 GET 仍 200，匿名 POST 仍 302', async () => {
  const svc = createMockPostService();
  await withServer(
    { getCurrentUser: anonymousUser, createPost: svc.createPost },
    async (base) => {
      const page = await fetch(`${base}/compose`);
      assert.equal(page.status, 200, 'FP-004 基线：GET 匿名可达');

      const submitted = await postContent(base, 'hello world');
      assert.equal(submitted.status, 302);
      assert.equal(submitted.headers.get('location'), '/login');
      assert.equal(svc.posts.length, 0);
    },
  );
});

/* ---------- 输入健壮性 ---------- */

test('R1: POST 缺 content 字段（空 body）→ 视为空串 EMPTY_CONTENT', async () => {
  const svc = createMockPostService();
  await withServer(
    { getCurrentUser: aliceUser, createPost: svc.createPost },
    async (base) => {
      const res = await fetch(`${base}/compose`, {
        method: 'POST',
        body: new URLSearchParams(),
        redirect: 'manual',
      });
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('data-reason="EMPTY_CONTENT"'));
      assert.equal(svc.posts.length, 0);
    },
  );
});

test('R2: PUT /compose → 405 且 Allow 含 GET 与 POST', async () => {
  await withServer({ getCurrentUser: aliceUser }, async (base) => {
    const res = await fetch(`${base}/compose`, { method: 'PUT' });
    assert.equal(res.status, 405);
    const allow = res.headers.get('allow') ?? '';
    assert.ok(allow.includes('GET'));
    assert.ok(allow.includes('POST'));
  });
});

test('R3: 超大请求体（> 64KB）→ 413，不触达发帖服务', async () => {
  const svc = createMockPostService();
  await withServer(
    { getCurrentUser: aliceUser, createPost: svc.createPost },
    async (base) => {
      const res = await postContent(base, 'x'.repeat(70000));
      assert.equal(res.status, 413);
      assert.equal(svc.posts.length, 0, '超大请求体不应触达发帖服务');
    },
  );
});
