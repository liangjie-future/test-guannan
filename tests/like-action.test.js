import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createWebServer, webUsers } from '../src/server.js';
import { createSessionAccess } from '../src/session-access.js';
import { createMemorySessionStore } from '../src/session-store.js';
import { createMemoryInteractionStore } from '../src/interaction-store.js';
import { parseLikeActionPath } from '../src/like-action.js';

/** §6 种子：会话 Cookie seed-token-1 = alice(1)；帖 P1 属 bob(2)。 */
const ALICE_COOKIE = 'session_token=seed-token-1';

function createLikeHarness({ likes = [] } = {}) {
  const sessionAccess = createSessionAccess({
    store: createMemorySessionStore({ users: webUsers() }),
  });
  const likeStore = createMemoryInteractionStore({ likes });
  const server = createWebServer({ sessionAccess, likeStore });
  return { sessionAccess, likeStore, server };
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

function fetchNoRedirect(url, options = {}) {
  return fetch(url, { ...options, redirect: 'manual' });
}

const aliceLikesOnP1 = (likeStore) =>
  likeStore.getLikesByPostIds([1]).filter((like) => like.user_id === 1);

test('TC-01: 登录者 POST /posts/1/like 产生唯一 (P1, alice) 并 PRG 回时间线', async () => {
  const h = createLikeHarness();
  await withServer(h.server, async (base) => {
    const res = await fetchNoRedirect(`${base}/posts/1/like`, {
      method: 'POST',
      headers: { cookie: ALICE_COOKIE },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/timeline');

    const likes = h.likeStore.getLikesByPostIds([1]);
    assert.equal(likes.length, 1, '应恰一条点赞记录');
    assert.equal(likes[0].post_id, 1);
    assert.equal(likes[0].user_id, 1);
    assert.ok(typeof likes[0].created_at === 'string' && likes[0].created_at.length > 0);
  });
});

test('TC-02: 已点赞者再次 POST → 取消点赞，记录删除', async () => {
  const h = createLikeHarness({ likes: [{ post_id: 1, user_id: 1, created_at: '2026-02-01T10:00:00.000Z' }] });
  await withServer(h.server, async (base) => {
    const res = await fetchNoRedirect(`${base}/posts/1/like`, {
      method: 'POST',
      headers: { cookie: ALICE_COOKIE },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/timeline');
    assert.deepEqual(h.likeStore.getLikesByPostIds([1]), [], '记录应已删除');
  });
});

test('TC-03: 未登录（无 Cookie / 无效 / 过期 token）POST → 302 /login 且不产生记录', async () => {
  const h = createLikeHarness();
  await withServer(h.server, async (base) => {
    for (const cookie of [undefined, 'session_token=nope', 'session_token=seed-token-expired']) {
      const res = await fetchNoRedirect(`${base}/posts/1/like`, {
        method: 'POST',
        headers: cookie === undefined ? {} : { cookie },
      });
      assert.equal(res.status, 302, `${cookie ?? '无 Cookie'} 应 302`);
      assert.equal(res.headers.get('location'), '/login');
    }
    assert.deepEqual(h.likeStore.getLikesByPostIds([1]), [], '不应产生任何点赞记录');
  });
});

test('TC-04a: 存储级连续两次 likePost → 恰一条（幂等）', async () => {
  const h = createLikeHarness();
  h.likeStore.likePost(1, 1);
  h.likeStore.likePost(1, 1);
  const likes = h.likeStore.getLikesByPostIds([1]);
  assert.equal(likes.length, 1);
  assert.equal(likes[0].user_id, 1);
});

test('TC-04b: 路由级连续两次 POST → toggle 回未赞态，他人记录保留', async () => {
  const h = createLikeHarness({ likes: [{ post_id: 1, user_id: 3, created_at: '2026-02-01T10:00:00.000Z' }] });
  await withServer(h.server, async (base) => {
    const options = { method: 'POST', headers: { cookie: ALICE_COOKIE } };
    await fetchNoRedirect(`${base}/posts/1/like`, options);
    assert.equal(aliceLikesOnP1(h.likeStore).length, 1, '第一次 POST 后 alice 应已点赞');
    assert.equal(h.likeStore.getLikesByPostIds([1]).length, 2, 'carol 记录并存');

    const res = await fetchNoRedirect(`${base}/posts/1/like`, options);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/timeline');
    assert.equal(aliceLikesOnP1(h.likeStore).length, 0, '第二次 POST 后 alice 无残留');
    const rest = h.likeStore.getLikesByPostIds([1]);
    assert.equal(rest.length, 1, '取消不误删他人记录');
    assert.equal(rest[0].user_id, 3);
  });
});

test('TC-05a: 存储层直接写入帖主自赞不被禁止', async () => {
  const h = createLikeHarness();
  h.likeStore.likePost(1, 2);
  const likes = h.likeStore.getLikesByPostIds([1]);
  assert.equal(likes.length, 1);
  assert.equal(likes[0].user_id, 2);
});

test('TC-05b: 帖主 bob 经路由对自己帖子点赞不被额外禁止', async () => {
  const h = createLikeHarness();
  const { token } = h.sessionAccess.createSessionOnLogin(2);
  await withServer(h.server, async (base) => {
    const res = await fetchNoRedirect(`${base}/posts/1/like`, {
      method: 'POST',
      headers: { cookie: `session_token=${token}` },
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/timeline');
    const likes = h.likeStore.getLikesByPostIds([1]);
    assert.equal(likes.length, 1);
    assert.equal(likes[0].post_id, 1);
    assert.equal(likes[0].user_id, 2);
  });
});

test('TC-06: 非 POST 请求 405（Allow: POST）且不产生记录', async () => {
  const h = createLikeHarness();
  await withServer(h.server, async (base) => {
    for (const method of ['GET', 'DELETE']) {
      const res = await fetchNoRedirect(`${base}/posts/1/like`, {
        method,
        headers: { cookie: ALICE_COOKIE },
      });
      assert.equal(res.status, 405, `${method} 应 405`);
      assert.equal(res.headers.get('allow'), 'POST');
    }
    assert.deepEqual(h.likeStore.getLikesByPostIds([1]), []);
  });
});

test('TC-07: 匿名 + 非 POST → 登录守卫先行，302 /login', async () => {
  const h = createLikeHarness();
  await withServer(h.server, async (base) => {
    const res = await fetchNoRedirect(`${base}/posts/1/like`, { method: 'GET' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
    assert.deepEqual(h.likeStore.getLikesByPostIds([1]), []);
  });
});

test('TC-08: 路径解析——命中与不命中形状', async () => {
  assert.equal(parseLikeActionPath('/posts/12/like'), 12);
  for (const pathname of [
    '/posts/abc/like',
    '/posts/1/like/extra',
    '/posts/1/likes',
    '/posts/1/unlike',
    '/users/3/follow',
    '/posts//like',
  ]) {
    assert.equal(parseLikeActionPath(pathname), null, `${pathname} 不应命中`);
  }
  const h = createLikeHarness();
  await withServer(h.server, async (base) => {
    const res = await fetchNoRedirect(`${base}/posts/abc/like`, {
      headers: { cookie: ALICE_COOKIE },
    });
    assert.equal(res.status, 404, '不命中动作路径应走既有 404 基线');
  });
});

test('TC-09: 组装基线——未注入 likeStore 路由不可达；未注入 sessionAccess 匿名跳登录', async () => {
  const access = createSessionAccess({ store: createMemorySessionStore({ users: webUsers() }) });
  const bare = createWebServer({ sessionAccess: access });
  await withServer(bare, async (base) => {
    const res = await fetchNoRedirect(`${base}/posts/1/like`, {
      method: 'POST',
      headers: { cookie: ALICE_COOKIE },
    });
    assert.equal(res.status, 404, '未注入 likeStore 时动作路由不应存在');
  });

  const likeStore = createMemoryInteractionStore({ likes: [] });
  const noGuard = createWebServer({ likeStore });
  await withServer(noGuard, async (base) => {
    const res = await fetchNoRedirect(`${base}/posts/1/like`, { method: 'POST' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
    assert.deepEqual(likeStore.getLikesByPostIds([1]), []);
  });
});
