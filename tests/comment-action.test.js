import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createWebServer } from '../src/server.js';
import {
  commentFailureLocation,
  createCommentAction,
  parseCommentActionPath,
  validateCommentContent,
} from '../src/comment-action.js';
import { createMemoryInteractionStore } from '../src/interaction-store.js';
import { createSessionAccess } from '../src/session-access.js';
import { createMemorySessionStore } from '../src/session-store.js';

/* ---------- §6 种子与测试文本 ---------- */

const S280 = 'y'.repeat(280);
const S281 = 'x'.repeat(281);
const ASTRAL_141 = '𝕒'.repeat(141);
const ASTRAL_281 = '𝕒'.repeat(281);

/** seed-token-1 ＝ alice(1)（仓库既有 createMemorySessionStore 种子）。 */
const ALICE_COOKIE = { cookie: 'session_token=seed-token-1' };
const aliceUser = () => ({ id: 1, username: 'alice' });

function createAccess() {
  return createSessionAccess({ store: createMemorySessionStore() });
}

/** 空评论种子 store（标准场景用户 / 帖 P1 归 bob 保留），getCommentsByPostIds 作断言面。 */
function createStore({ now } = {}) {
  return createMemoryInteractionStore({ comments: [], now });
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

function postComment(base, postId, content, headers = {}) {
  return fetch(`${base}/posts/${postId}/comment`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ content }),
    redirect: 'manual',
  });
}

function request(base, postId, method, headers = {}) {
  return fetch(`${base}/posts/${postId}/comment`, { method, headers, redirect: 'manual' });
}

function locationParams(location) {
  return new URL(location, 'http://localhost').searchParams;
}

/* ---------- 单元层（纯函数） ---------- */

test('U1: parseCommentActionPath——合法路径出数字 id，其余形状 null', () => {
  assert.equal(parseCommentActionPath('/posts/1/comment'), 1);
  assert.equal(parseCommentActionPath('/posts/42/comment'), 42);
  for (const pathname of [
    '/posts/abc/comment',
    '/posts/1/comments',
    '/posts/1/comment/x',
    '/posts//comment',
    '/posts/1',
    '/comment',
    '/posts/1/like',
  ]) {
    assert.equal(parseCommentActionPath(pathname), null, `${pathname} 应不匹配`);
  }
});

test('U2: validateCommentContent——空串 / 全空白 / 纯制表换行均 EMPTY_CONTENT', () => {
  for (const empty of ['', '   ', '\t\n ']) {
    assert.deepEqual(validateCommentContent(empty), {
      status: 'ERROR',
      reason: 'EMPTY_CONTENT',
    });
  }
});

test('U3: validateCommentContent——281 字 TOO_LONG；恰 280 与 trim 后恰 280 均 OK', () => {
  assert.deepEqual(validateCommentContent(S281), { status: 'ERROR', reason: 'TOO_LONG' });

  const ok = validateCommentContent(S280);
  assert.equal(ok.status, 'OK');
  assert.equal(ok.text, S280);

  const trimmed = validateCommentContent(`  ${S280}\n`);
  assert.equal(trimmed.status, 'OK', '去首尾空白后恰 280 应通过（280 含边界）');
  assert.equal(trimmed.text, S280, '落库文本为 trim 后形态');
});

test('U4: validateCommentContent——码点口径：141 个非 BMP 字符 OK，281 个 TOO_LONG', () => {
  assert.equal(validateCommentContent(ASTRAL_141).status, 'OK');
  assert.equal(validateCommentContent(ASTRAL_281).reason, 'TOO_LONG');
});

test('U5: validateCommentContent——非字符串 content 抛 TypeError', () => {
  assert.throws(() => validateCommentContent(null), TypeError);
});

test('U6: commentFailureLocation——参数顺序固定，原输入可经 searchParams 无损还原', () => {
  const location = commentFailureLocation(1, 'TOO_LONG', 'a b');
  assert.equal(
    location,
    '/timeline?comment_failed_post=1&comment_error=TOO_LONG&comment_text=a+b',
  );

  const cjk = commentFailureLocation(7, 'EMPTY_CONTENT', '  中文  ');
  assert.ok(cjk.startsWith('/timeline?comment_failed_post=7&comment_error=EMPTY_CONTENT&comment_text='));
  assert.equal(locationParams(cjk).get('comment_text'), '  中文  ');
});

test('U7: createCommentAction 未注入 createComment 时 fail-fast', () => {
  assert.throws(() => createCommentAction({}), /createComment/);
});

/* ---------- 验收用例（A 组，seed-token-1＝alice） ---------- */

test('A1: alice POST content=hello → 落库恰一条（末位）且 302 /timeline', async () => {
  const store = createStore({ now: () => '2026-03-01T00:00:00.000Z' });
  await withServer(
    { sessionAccess: createAccess(), createComment: store.createComment },
    async (base) => {
      const res = await postComment(base, 1, 'hello', ALICE_COOKIE);
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/timeline');

      const listed = store.getCommentsByPostIds([1]);
      assert.equal(listed.length, 1, '该帖恰一条评论');
      assert.deepEqual(listed[0], {
        id: 1,
        post_id: 1,
        user_id: 1,
        content: 'hello',
        created_at: '2026-03-01T00:00:00.000Z',
      });
    },
  );
});

test('A2: 281 字 → 无记录，Location 携带 failed_post / TOO_LONG / 原输入', async () => {
  const store = createStore();
  await withServer(
    { sessionAccess: createAccess(), createComment: store.createComment },
    async (base) => {
      const res = await postComment(base, 1, S281, ALICE_COOKIE);
      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location.startsWith('/timeline?'), '应回跳 /timeline');
      assert.ok(
        location.includes('comment_failed_post=1&comment_error=TOO_LONG&comment_text='),
        '回显参数顺序与任务卡 §3.2-4 一致',
      );
      const params = locationParams(location);
      assert.equal(params.get('comment_failed_post'), '1');
      assert.equal(params.get('comment_error'), 'TOO_LONG');
      assert.equal(params.get('comment_text'), S281, '原输入 URL 编码保留');

      assert.equal(store.getCommentsByPostIds([1]).length, 0, '超限评论不落库');
    },
  );
});

test('A3: 全空白 → 无记录，EMPTY_CONTENT 且 comment_text 为原输入', async () => {
  const store = createStore();
  await withServer(
    { sessionAccess: createAccess(), createComment: store.createComment },
    async (base) => {
      const res = await postComment(base, 1, '   ', ALICE_COOKIE);
      assert.equal(res.status, 302);
      const params = locationParams(res.headers.get('location'));
      assert.equal(params.get('comment_failed_post'), '1');
      assert.equal(params.get('comment_error'), 'EMPTY_CONTENT');
      assert.equal(params.get('comment_text'), '   ', '输入保留的回显数据源');

      assert.equal(store.getCommentsByPostIds([1]).length, 0);
    },
  );
});

test('A4: 未登录 POST → 302 /login，无评论记录', async () => {
  const store = createStore();
  await withServer(
    { sessionAccess: createAccess(), createComment: store.createComment },
    async (base) => {
      const res = await postComment(base, 1, 'hello');
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
      assert.equal(store.getCommentsByPostIds([1]).length, 0, '匿名提交不产生评论');
    },
  );
});

test('A5: 去首尾空白后恰 280 字（按码点计）→ 成功落库', async () => {
  const store = createStore();
  await withServer(
    { sessionAccess: createAccess(), createComment: store.createComment },
    async (base) => {
      const res = await postComment(base, 1, `  ${S280}`, ALICE_COOKIE);
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/timeline');

      const listed = store.getCommentsByPostIds([1]);
      assert.equal(listed.length, 1);
      assert.equal(listed[0].content, S280, '落库内容为 trim 后 280 字（上限含边界）');
    },
  );
});

/* ---------- 守卫与方法（G 组） ---------- */

test('G1: 基线兼容（未注入 sessionAccess）——currentUser 替身 alice 提交成功', async () => {
  const store = createStore();
  await withServer(
    { getCurrentUser: aliceUser, createComment: store.createComment },
    async (base) => {
      const res = await postComment(base, 1, 'hello');
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/timeline');
      assert.equal(store.getCommentsByPostIds([1]).length, 1);
      assert.equal(store.getCommentsByPostIds([1])[0].user_id, 1);
    },
  );
});

test('G2: 基线匿名（未注入 sessionAccess）POST → 302 /login，无记录', async () => {
  const store = createStore();
  await withServer(
    { getCurrentUser: () => null, createComment: store.createComment },
    async (base) => {
      const res = await postComment(base, 1, 'hello');
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
      assert.equal(store.getCommentsByPostIds([1]).length, 0, '匿名 POST 不放行');
    },
  );
});

test('G3: 已登录 GET /posts/1/comment → 405 且 Allow: POST，无记录', async () => {
  const store = createStore();
  await withServer(
    { sessionAccess: createAccess(), createComment: store.createComment },
    async (base) => {
      const res = await request(base, 1, 'GET', ALICE_COOKIE);
      assert.equal(res.status, 405);
      assert.equal(res.headers.get('allow'), 'POST');
      assert.equal(store.getCommentsByPostIds([1]).length, 0);
    },
  );
});

test('G4: 已登录 PUT / DELETE → 405 且 Allow: POST', async () => {
  await withServer(
    { sessionAccess: createAccess(), createComment: createStore().createComment },
    async (base) => {
      for (const method of ['PUT', 'DELETE']) {
        const res = await request(base, 1, method, ALICE_COOKIE);
        assert.equal(res.status, 405, `${method} 应 405`);
        assert.equal(res.headers.get('allow'), 'POST');
      }
    },
  );
});

test('G5: 未登录 GET → 302 /login（登录守卫先于方法判定）', async () => {
  await withServer(
    { sessionAccess: createAccess(), createComment: createStore().createComment },
    async (base) => {
      const res = await request(base, 1, 'GET');
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/login');
    },
  );
});

/* ---------- 健壮性（R 组） ---------- */

test('R1: POST 缺 content 字段（空 body）→ 归一空串走 EMPTY_CONTENT', async () => {
  const store = createStore();
  await withServer(
    { sessionAccess: createAccess(), createComment: store.createComment },
    async (base) => {
      const res = await fetch(`${base}/posts/1/comment`, {
        method: 'POST',
        headers: ALICE_COOKIE,
        body: new URLSearchParams(),
        redirect: 'manual',
      });
      assert.equal(res.status, 302);
      assert.equal(locationParams(res.headers.get('location')).get('comment_error'), 'EMPTY_CONTENT');
      assert.equal(store.getCommentsByPostIds([1]).length, 0);
    },
  );
});

test('R2: 超大请求体（> 64KB）→ 413，不触达评论存取', async () => {
  const store = createStore();
  await withServer(
    { sessionAccess: createAccess(), createComment: store.createComment },
    async (base) => {
      const res = await postComment(base, 1, 'x'.repeat(70000), ALICE_COOKIE);
      assert.equal(res.status, 413);
      assert.equal(store.getCommentsByPostIds([1]).length, 0, '超大请求体不应触达 store');
    },
  );
});

test('R3: 非动作形状 /posts/abc/comment → 404（不误判为动作路由）', async () => {
  await withServer(
    { sessionAccess: createAccess(), createComment: createStore().createComment },
    async (base) => {
      const res = await fetch(`${base}/posts/abc/comment`, {
        headers: ALICE_COOKIE,
        redirect: 'manual',
      });
      assert.equal(res.status, 404);
    },
  );
});

test('R4: 连续两条评论均落库，created_at 正序时新评论为末位', async () => {
  const times = ['2026-03-01T10:00:00.000Z', '2026-03-01T10:00:01.000Z'];
  let tick = 0;
  const store = createStore({ now: () => times[tick++] });
  await withServer(
    { sessionAccess: createAccess(), createComment: store.createComment },
    async (base) => {
      await postComment(base, 1, 'first', ALICE_COOKIE);
      await postComment(base, 1, 'second', ALICE_COOKIE);

      const listed = store.getCommentsByPostIds([1]);
      assert.equal(listed.length, 2);
      assert.deepEqual(
        listed.map((c) => c.content),
        ['first', 'second'],
        '读取方 created_at 正序，新评论居末位',
      );
      assert.ok(Date.parse(listed[0].created_at) < Date.parse(listed[1].created_at));
    },
  );
});

test('R5: XSS 边界——失败 Location 携带编码原输入，可无损还原且无原始注入串', async () => {
  const store = createStore();
  await withServer(
    { sessionAccess: createAccess(), createComment: store.createComment },
    async (base) => {
      const payload = `<script>alert(1)</script>${S280}`;
      const res = await postComment(base, 1, payload, ALICE_COOKIE);
      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(!location.includes('<script'), 'Location 应为编码形态');
      assert.equal(locationParams(location).get('comment_text'), payload, '还原等于原输入');
      assert.equal(store.getCommentsByPostIds([1]).length, 0, '超限不落库');
    },
  );
});
