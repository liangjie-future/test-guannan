import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createWebServer, webUsers } from '../src/server.js';
import { createSessionAccess } from '../src/session-access.js';
import { createMemorySessionStore } from '../src/session-store.js';
import { createMemoryInteractionStore } from '../src/interaction-store.js';
import { createTimelineInteractionArea } from '../src/timeline-interactions.js';

/**
 * FP-009 互动服务端强制过滤与鉴权兜底（任务卡 §7 验收 1–5 + 组装层单元面）。
 * HTTP 级：createWebServer + 临时端口真实请求（风格对齐 tests/like-action.test.js）。
 */

/* ---------- §6 种子：标准场景（与 FP-004 §6 同构） ---------- */

/** 时间线恒返回帖 P1（bob）——避免 carol 作者名干扰全局用户名缺席断言。 */
const P1 = {
  id: 1,
  author_id: 2,
  author_username: 'bob',
  content: '早起的鸟儿有虫吃',
  created_at: '2026-02-01T09:00:00.000Z',
};

/** 被隐藏互动痕迹清单（dave 视角：carol / alice / bob 的互动全部不可见）。 */
const HIDDEN_USERNAMES = ['carol', 'alice'];
const HIDDEN_CONTENTS = ['好帖，顶一个', '谢谢大家', '写得太好了'];

const ALICE_COOKIE = { cookie: 'session_token=seed-token-1' };

/** 场景用户表：webUsers()（alice + 登录替身 bob）增补 carol / dave。 */
function scenarioUsers() {
  const users = webUsers();
  const created_at = new Date().toISOString();
  for (const [id, username] of [
    [3, 'carol'],
    [4, 'dave'],
  ]) {
    users.set(id, {
      id,
      username,
      password_hash: `hash-${username}-placeholder`,
      salt: `salt-${username}-placeholder`,
      created_at,
    });
  }
  return users;
}

/** 组装验证载具：会话（alice / dave / 过期）+ 标准场景互动 store + 只含 P1 的时间线。 */
function createEnforcementHarness() {
  const sessionAccess = createSessionAccess({
    store: createMemorySessionStore({ users: scenarioUsers() }),
  });
  const dave = sessionAccess.createSessionOnLogin(4);
  const interactionStore = createMemoryInteractionStore();
  const server = createWebServer({
    sessionAccess,
    getTimeline: () => [{ ...P1 }],
    likeStore: interactionStore,
    createComment: interactionStore.createComment,
    interactionVisibility: interactionStore,
  });
  return {
    sessionAccess,
    daveCookie: { cookie: `session_token=${dave.token}` },
    store: interactionStore,
    server,
  };
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

const countOccurrences = (html, marker) => html.split(marker).length - 1;

const countLikes = (html) => countOccurrences(html, 'data-testid="visible-like"');
const countComments = (html) => countOccurrences(html, 'data-testid="visible-comment"');

/** 从 HTML 中截取互动区块（无嵌套 div，可直接以闭合标签截断）。 */
function interactionAreaHtml(html) {
  const match = /data-testid="post-interactions"[\s\S]*?<\/div>/.exec(html);
  return match === null ? '' : match[0];
}

/* ---------- 验收 1：读取守卫回归 ---------- */

test('AC1: 未登录 / 过期 / 无效凭据 GET /timeline 一律 302 /login', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    for (const headers of [
      {},
      { cookie: 'session_token=seed-token-expired' },
      { cookie: 'session_token=nope' },
    ]) {
      const res = await fetchNoRedirect(`${base}/timeline`, { headers });
      assert.equal(res.status, 302, `${JSON.stringify(headers)} 应 302`);
      assert.equal(res.headers.get('location'), '/login');
    }
  });
});

/* ---------- 验收 2：互动写入动作纳入守卫 ---------- */

test('AC2-a/b: 未登录 POST 点赞与评论 → 302 /login 且 store 无新互动记录', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    const seedLikes = h.store.getLikesByPostIds([1]);
    const seedComments = h.store.getCommentsByPostIds([1]);
    assert.equal(seedLikes.length, 3, '标准场景种子点赞 3 条');
    assert.equal(seedComments.length, 4, '标准场景种子评论 4 条');

    const like = await fetchNoRedirect(`${base}/posts/1/like`, { method: 'POST' });
    assert.equal(like.status, 302);
    assert.equal(like.headers.get('location'), '/login');

    const comment = await fetchNoRedirect(`${base}/posts/1/comment`, {
      method: 'POST',
      body: new URLSearchParams({ content: '匿名也想评论' }),
    });
    assert.equal(comment.status, 302);
    assert.equal(comment.headers.get('location'), '/login');

    assert.deepEqual(h.store.getLikesByPostIds([1]), seedLikes, '点赞记录不应变化');
    assert.deepEqual(h.store.getCommentsByPostIds([1]), seedComments, '评论不应落库');
  });
});

test('AC2-c: 过期 / 无效 token 的动作提交视同匿名 → 302 /login、无新记录', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    const seedLikes = h.store.getLikesByPostIds([1]);
    const seedComments = h.store.getCommentsByPostIds([1]);
    for (const cookie of ['session_token=seed-token-expired', 'session_token=nope']) {
      for (const path of ['/posts/1/like', '/posts/1/comment']) {
        const res = await fetchNoRedirect(`${base}${path}`, {
          method: 'POST',
          headers: { cookie },
          body: new URLSearchParams({ content: 'should-not-persist' }),
        });
        assert.equal(res.status, 302, `${cookie} ${path} 应 302`);
        assert.equal(res.headers.get('location'), '/login');
      }
    }
    assert.deepEqual(h.store.getLikesByPostIds([1]), seedLikes);
    assert.deepEqual(h.store.getCommentsByPostIds([1]), seedComments);
  });
});

/* ---------- 验收 3：读取强制过滤（dave 非共同好友） ---------- */

test('AC3-a: dave GET /timeline → 200，互动区仅含自身可见互动', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    const res = await fetchNoRedirect(`${base}/timeline`, { headers: h.daveCookie });
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.equal(countOccurrences(html, 'data-testid="post-interactions"'), 1, 'P1 应内嵌互动区');
    assert.equal(countLikes(html), 1, '可见点赞恰 1 条（dave 自己）');
    assert.equal(countComments(html), 1, '可见评论恰 1 条（dave 自己）');
    assert.ok(html.includes('data-user-id="4" data-viewer-liked="true"'), 'dave 点赞应带 viewer_liked');
    assert.ok(html.includes('路过支持'), 'dave 自己的评论可见');
  });
});

test('AC3-b: dave 视角响应不含 carol / alice 用户名与任何被隐藏互动内容', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    const html = await (await fetchNoRedirect(`${base}/timeline`, { headers: h.daveCookie })).text();
    for (const username of HIDDEN_USERNAMES) {
      assert.ok(!html.includes(username), `被隐藏者用户名 ${username} 不应出现`);
    }
    for (const content of HIDDEN_CONTENTS) {
      assert.ok(!html.includes(content), `被隐藏评论内容「${content}」不应出现`);
    }
    const likeIds = [...html.matchAll(/data-testid="visible-like" data-user-id="(\d+)"/g)].map((m) => m[1]);
    assert.deepEqual(likeIds, ['4'], '可见点赞用户只有 dave');
  });
});

test('AC3-c: 正向对照（alice）——过滤按规则而非一刀切：carol 与自身互动可见', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    const html = await (await fetchNoRedirect(`${base}/timeline`, { headers: ALICE_COOKIE })).text();
    const likeIds = [...html.matchAll(/data-testid="visible-like" data-user-id="(\d+)"/g)].map((m) => m[1]);
    assert.deepEqual(likeIds, ['3'], 'alice 可见点赞＝carol');
    assert.equal(countComments(html), 2, '可见评论＝c1 carol + c4 alice');
    assert.ok(html.includes('好帖，顶一个'));
    assert.ok(html.includes('写得太好了'));
    assert.ok(!html.includes('路过支持'), 'dave 评论对 alice 不可见');
    assert.ok(!html.includes('谢谢大家'), 'bob 自评对 alice 不可见');
  });
});

/* ---------- 验收 4：无存在性泄露（计数差 / 占位 / 时序空洞） ---------- */

test('AC4-a: 计数＝可见数（dave 1/1、alice 1/2），无总互动量或差值字段', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    const daveHtml = await (await fetchNoRedirect(`${base}/timeline`, { headers: h.daveCookie })).text();
    assert.ok(daveHtml.includes('data-testid="visible-like-count" data-count="1"'));
    assert.ok(daveHtml.includes('data-testid="visible-comment-count" data-count="1"'));

    const aliceHtml = await (await fetchNoRedirect(`${base}/timeline`, { headers: ALICE_COOKIE })).text();
    assert.ok(aliceHtml.includes('data-testid="visible-like-count" data-count="1"'));
    assert.ok(aliceHtml.includes('data-testid="visible-comment-count" data-count="2"'));
    assert.ok(!aliceHtml.includes('data-count="3"'), '不应出现被隐藏点赞造成的计数差');
    assert.ok(!aliceHtml.includes('data-count="4"'), '不应出现总评论数');
  });
});

test('AC4-b: 互动区无占位提示、无时序空洞，可见评论按服务正序连续渲染', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    const html = await (await fetchNoRedirect(`${base}/timeline`, { headers: ALICE_COOKIE })).text();
    const area = interactionAreaHtml(html);
    assert.notEqual(area, '', '应存在互动区');
    for (const phrase of ['还有', '隐藏', '不可见', '仅显示', '部分互动', '...', '…']) {
      assert.ok(!area.includes(phrase), `互动区不应含占位 / 存在性提示：「${phrase}」`);
    }
    const first = html.indexOf('好帖，顶一个');
    const second = html.indexOf('写得太好了');
    assert.ok(first !== -1 && second !== -1 && first < second, '可见评论按服务正序渲染');
  });
});

test('AC4-c: dave 视角 HTML 源码全量断言——被隐藏互动零痕迹', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    const html = await (await fetchNoRedirect(`${base}/timeline`, { headers: h.daveCookie })).text();
    for (const username of HIDDEN_USERNAMES) {
      assert.ok(!html.includes(username), `源码级无 ${username}`);
    }
    for (const content of HIDDEN_CONTENTS) {
      assert.ok(!html.includes(content), `源码级无「${content}」`);
    }
    for (const marker of ['data-count="3"', 'data-count="4"', '还有', '隐藏']) {
      assert.ok(!interactionAreaHtml(html).includes(marker), `源码级无存在性痕迹 ${marker}`);
    }
  });
});

/* ---------- 验收 5：不可绕过（不依赖前端隐藏） ---------- */

test('AC5-a: 登录用户 GET 动作路径 → 405（Allow: POST），无互动数据', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    for (const path of ['/posts/1/like', '/posts/1/comment']) {
      const res = await fetchNoRedirect(`${base}${path}`, { headers: h.daveCookie });
      assert.equal(res.status, 405, `GET ${path} 应 405`);
      assert.equal(res.headers.get('allow'), 'POST');
      const body = await res.text();
      for (const content of HIDDEN_CONTENTS) {
        assert.ok(!body.includes(content), '405 响应不得泄露互动数据');
      }
    }
  });
});

test('AC5-b: 构造的互动数据访问路径 → 404，响应体无被隐藏互动', async () => {
  const h = createEnforcementHarness();
  await withServer(h.server, async (base) => {
    for (const path of ['/posts/1/comments', '/posts/1', '/api/posts/1/comments', '/posts/1/interactions']) {
      const res = await fetchNoRedirect(`${base}${path}`, { headers: h.daveCookie });
      assert.equal(res.status, 404, `GET ${path} 应 404`);
      const body = await res.text();
      for (const content of HIDDEN_CONTENTS) {
        assert.ok(!body.includes(content), `${path} 响应不得泄露互动数据`);
      }
    }
  });
});

test('AC5-c: 数据源唯一性——渲染恰为注入可见性服务的输出（spy 断言）', async () => {
  const calls = [];
  const markerVisibility = {
    getVisibleInteractions(viewerId, posts) {
      calls.push([viewerId, posts]);
      return [
        {
          post_id: 1,
          likes: [{ user_id: 99, created_at: '2026-02-02T10:00:00.000Z' }],
          comments: [{ id: 501, user_id: 99, content: '唯一可见评论', created_at: '2026-02-02T11:00:00.000Z' }],
          visible_like_count: 1,
          visible_comment_count: 1,
        },
      ];
    },
    getUserById: (id) => (id === 99 ? { id, username: 'mallory' } : null),
  };
  const sessionAccess = createSessionAccess({
    store: createMemorySessionStore({ users: scenarioUsers() }),
  });
  const server = createWebServer({
    sessionAccess,
    getTimeline: () => [{ ...P1 }],
    interactionVisibility: markerVisibility,
  });
  await withServer(server, async (base) => {
    const dave = sessionAccess.createSessionOnLogin(4);
    const html = await (
      await fetchNoRedirect(`${base}/timeline`, { headers: { cookie: `session_token=${dave.token}` } })
    ).text();
    assert.ok(html.includes('mallory'), '渲染来源应为可见性服务输出');
    assert.ok(html.includes('唯一可见评论'));
    assert.ok(html.includes('data-testid="visible-like-count" data-count="1"'));
    assert.equal(countLikes(html), 1);
    assert.equal(countComments(html), 1);
    for (const content of HIDDEN_CONTENTS) {
      assert.ok(!html.includes(content), 'store 侧互动不得绕过服务直达渲染');
    }
    assert.deepEqual(calls, [[4, [{ ...P1 }]]], '以 (viewer.id, posts) 批量调用一次');
  });
});

test('AC0: 未注入 interactionVisibility → /timeline 保持 FP-014 基线（无互动区）', async () => {
  const sessionAccess = createSessionAccess({
    store: createMemorySessionStore({ users: scenarioUsers() }),
  });
  const server = createWebServer({ sessionAccess, getTimeline: () => [{ ...P1 }] });
  await withServer(server, async (base) => {
    const dave = sessionAccess.createSessionOnLogin(4);
    const res = await fetchNoRedirect(`${base}/timeline`, {
      headers: { cookie: `session_token=${dave.token}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(countOccurrences(html, 'data-testid="post-interactions"'), 0);
    assert.equal(countOccurrences(html, 'data-testid="timeline-item"'), 1);
  });
});

/* ---------- 组装层单元面 ---------- */

test('U1: assemble 补齐 username / viewer_liked，条目与计数对齐可见性服务输出', () => {
  const store = createMemoryInteractionStore();
  const area = createTimelineInteractionArea({ visibility: store });
  const assembled = area.assemble({ id: 4, username: 'dave' }, [{ ...P1 }]);
  assert.equal(assembled.length, 1);
  const [entry] = assembled;
  assert.equal(entry.post_id, 1);
  assert.equal(entry.visible_like_count, 1);
  assert.equal(entry.visible_comment_count, 1);
  assert.deepEqual(entry.likes, [
    { user_id: 4, username: 'dave', viewer_liked: true, created_at: '2026-02-01T10:00:01.000Z' },
  ]);
  assert.deepEqual(entry.comments, [
    { id: 2, user_id: 4, username: 'dave', content: '路过支持', created_at: '2026-02-01T11:00:01.000Z' },
  ]);
});

test('U2: getUserById 缺失或未知用户 → username 回落 用户#<id>，可见条目仍渲染', () => {
  const store = createMemoryInteractionStore();
  const bare = {
    getVisibleInteractions: (viewerId, posts) => store.getVisibleInteractions(viewerId, posts),
  };
  const withoutDirectory = createTimelineInteractionArea({ visibility: bare });
  const [entry] = withoutDirectory.assemble({ id: 4 }, [{ ...P1 }]);
  assert.equal(entry.likes[0].username, '用户#4');
  assert.equal(entry.comments[0].username, '用户#4');

  const withNullLookup = createTimelineInteractionArea({
    visibility: bare,
    getUserById: () => null,
  });
  const [entry2] = withNullLookup.assemble({ id: 4 }, [{ ...P1 }]);
  assert.equal(entry2.likes[0].username, '用户#4');
});

test('U3: 无互动帖 / 空帖子流 → 0 计数 + 空列表，无占位、不抛错', () => {
  const store = createMemoryInteractionStore();
  const area = createTimelineInteractionArea({ visibility: store });
  const viewer = { id: 4, username: 'dave' };

  assert.deepEqual(area.assemble(viewer, []), [], '空帖子流 → 空组装');

  const fragments = area.renderFragments(viewer, [{ id: 9, author_id: 2 }, { ...P1 }]);
  const quiet = fragments.get(9);
  assert.notEqual(quiet, undefined);
  assert.ok(quiet.includes('data-testid="visible-like-count" data-count="0"'));
  assert.ok(quiet.includes('data-testid="visible-comment-count" data-count="0"'));
  for (const phrase of ['还有', '隐藏', '不可见']) {
    assert.ok(!quiet.includes(phrase), '零可见互动不应出现占位提示');
  }
  assert.ok(fragments.has(1), '有互动帖正常产出片段');
});

test('U4: renderFragments 输出经 escapeHtml 转义，防注入', () => {
  const visibility = {
    getVisibleInteractions: () => [
      {
        post_id: 1,
        likes: [],
        comments: [{ id: 1, user_id: 5, content: '<script>alert(1)</script>', created_at: 't' }],
        visible_like_count: 0,
        visible_comment_count: 1,
      },
    ],
    getUserById: (id) => ({ id, username: '<b>evil</b>' }),
  };
  const fragments = createTimelineInteractionArea({ visibility }).renderFragments({ id: 1 }, [{ ...P1 }]);
  const html = fragments.get(1);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>evil</b>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
