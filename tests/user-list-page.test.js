import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createWebServer } from '../src/server.js';
import { createSessionAccess } from '../src/session-access.js';
import { createMemorySessionStore } from '../src/session-store.js';
import { createMemorySocialStore } from '../src/social-store.js';
import { createFollowService } from '../src/follow-service.js';
import { createUsersPage } from '../src/users-page.js';

/**
 * 装配夹具：真实内存社交 store + 记录型 follow Mock（委托 FP-011 规则适配），
 * 会话层用 FP-003 内存 store（种子用户 alice id=1）。
 */
function createFixture() {
  const socialStore = createMemorySocialStore();
  const followService = createFollowService({ store: socialStore });
  const calls = [];
  const usersPage = createUsersPage({
    listUsers: socialStore.listUsers,
    follow: (followerId, followeeId) => {
      calls.push([followerId, followeeId]);
      return followService.follow(followerId, followeeId);
    },
    getFolloweeIds: followService.getFolloweeIds,
  });
  const sessionAccess = createSessionAccess({ store: createMemorySessionStore() });
  return { socialStore, followService, calls, usersPage, sessionAccess };
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

function loginAlice(access) {
  return access.createSessionOnLogin(1);
}

test('H1: 匿名 GET /users → 302 /login（requireLogin 装配）', async () => {
  const { sessionAccess, usersPage } = createFixture();
  await withServer({ sessionAccess, usersPage }, async (base) => {
    const res = await fetchNoRedirect(`${base}/users`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
  });
});

test('H2: 已登录 GET /users → 200 统一布局，3 用户全展示，自己行标识且无关注按钮', async () => {
  const { sessionAccess, usersPage } = createFixture();
  const { token } = loginAlice(sessionAccess);
  await withServer({ sessionAccess, usersPage }, async (base) => {
    const res = await fetchNoRedirect(`${base}/users`, {
      headers: { cookie: `session_token=${token}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /class="site-header"/);
    assert.match(html, /class="site-footer"/);
    for (const name of ['alice', 'bob', 'carol']) {
      assert.ok(html.includes(name), `缺少用户 ${name}`);
    }
    const selfRow = html.match(/<tr[^>]*data-user-id="1"[^>]*>[^]*?<\/tr>/)[0];
    assert.ok(selfRow.includes('data-self="true"'), '自己行区分标识');
    assert.ok(!selfRow.includes('<form') && !selfRow.includes('<button'), '自己行无可用关注操作');
    const bobRow = html.match(/<tr[^>]*data-user-id="2"[^>]*>[^]*?<\/tr>/)[0];
    assert.ok(bobRow.includes('data-follow-state="following"'), '种子边 bob 已关注');
    const carolRow = html.match(/<tr[^>]*data-user-id="3"[^>]*>[^]*?<\/tr>/)[0];
    assert.ok(carolRow.includes('data-follow-state="not-following"'), 'carol 未关注');
  });
});

test('H3: POST /users/3/follow → 303 成功反馈；follow Mock 收到 (1,3)；状态更新', async () => {
  const { sessionAccess, usersPage, calls } = createFixture();
  const { token } = loginAlice(sessionAccess);
  await withServer({ sessionAccess, usersPage }, async (base) => {
    const cookie = { cookie: `session_token=${token}` };
    const res = await fetchNoRedirect(`${base}/users/3/follow`, { method: 'POST', headers: cookie });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/users?notice=FOLLOW_OK&username=carol');
    assert.deepEqual(calls, [[1, 3]]);

    const after = await (
      await fetchNoRedirect(`${base}${res.headers.get('location')}`, { headers: cookie })
    ).text();
    const carolRow = after.match(/<tr[^>]*data-user-id="3"[^>]*>[^]*?<\/tr>/)[0];
    assert.ok(carolRow.includes('data-follow-state="following"'), '关注后行状态更新');
    assert.ok(after.includes('已关注 carol'), '页面反馈关注生效');
  });
});

test('H4: POST /users/2/follow（种子已关注）→ 幂等，仍恰一条边', async () => {
  const fixture = createFixture();
  const { token } = loginAlice(fixture.sessionAccess);
  await withServer({ sessionAccess: fixture.sessionAccess, usersPage: fixture.usersPage }, async (base) => {
    const cookie = { cookie: `session_token=${token}` };
    const res = await fetchNoRedirect(`${base}/users/2/follow`, { method: 'POST', headers: cookie });
    assert.equal(res.status, 303);
    assert.deepEqual(fixture.socialStore.getFolloweeIds(1), [2], '幂等：仍恰一条边');
  });
});

test('H5: POST /users/1/follow（自关注直连）→ 拒绝反馈，不产生自环边', async () => {
  const fixture = createFixture();
  const { token } = loginAlice(fixture.sessionAccess);
  await withServer({ sessionAccess: fixture.sessionAccess, usersPage: fixture.usersPage }, async (base) => {
    const cookie = { cookie: `session_token=${token}` };
    const res = await fetchNoRedirect(`${base}/users/1/follow`, { method: 'POST', headers: cookie });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/users?notice=SELF_FOLLOW_NOT_ALLOWED');
    assert.deepEqual(fixture.calls, [[1, 1]]);
    assert.equal(fixture.socialStore.followExists(1, 1), false);

    const after = await (
      await fetchNoRedirect(`${base}${res.headers.get('location')}`, { headers: cookie })
    ).text();
    assert.ok(after.includes('不可关注自己'), '页面提示不可关注自己');
  });
});

test('H6: POST /users/999/follow → 用户不存在反馈，无边产生', async () => {
  const fixture = createFixture();
  const { token } = loginAlice(fixture.sessionAccess);
  await withServer({ sessionAccess: fixture.sessionAccess, usersPage: fixture.usersPage }, async (base) => {
    const res = await fetchNoRedirect(`${base}/users/999/follow`, {
      method: 'POST',
      headers: { cookie: `session_token=${token}` },
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/users?notice=FOLLOWEE_NOT_FOUND');
    assert.deepEqual(fixture.socialStore.getFolloweeIds(1), [2]);
  });
});

test('H7: 匿名 POST /users/3/follow → 302 /login 且 follow Mock 零调用', async () => {
  const fixture = createFixture();
  await withServer({ sessionAccess: fixture.sessionAccess, usersPage: fixture.usersPage }, async (base) => {
    const res = await fetchNoRedirect(`${base}/users/3/follow`, { method: 'POST' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
    assert.deepEqual(fixture.calls, []);
  });
});

test('H8: GET /users/3/follow（方法不符）→ 405', async () => {
  const fixture = createFixture();
  const { token } = loginAlice(fixture.sessionAccess);
  await withServer({ sessionAccess: fixture.sessionAccess, usersPage: fixture.usersPage }, async (base) => {
    const res = await fetchNoRedirect(`${base}/users/3/follow`, {
      headers: { cookie: `session_token=${token}` },
    });
    assert.equal(res.status, 405);
  });
});

test('H9: POST /users/abc/follow（非数字 id）→ 404 统一布局', async () => {
  const fixture = createFixture();
  const { token } = loginAlice(fixture.sessionAccess);
  await withServer({ sessionAccess: fixture.sessionAccess, usersPage: fixture.usersPage }, async (base) => {
    const res = await fetchNoRedirect(`${base}/users/abc/follow`, {
      method: 'POST',
      headers: { cookie: `session_token=${token}` },
    });
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.match(html, /class="site-header"/);
  });
});

test('H10: currentUser 替身（无 sessionAccess，§6 形态）驱动渲染 3 用户', async () => {
  const fixture = createFixture();
  await withServer(
    { getCurrentUser: () => ({ id: 1, username: 'alice' }), usersPage: fixture.usersPage },
    async (base) => {
      const res = await fetchNoRedirect(`${base}/users`);
      assert.equal(res.status, 200);
      const html = await res.text();
      for (const name of ['alice', 'bob', 'carol']) {
        assert.ok(html.includes(name), `缺少用户 ${name}`);
      }
      const selfRow = html.match(/<tr[^>]*data-user-id="1"[^>]*>[^]*?<\/tr>/)[0];
      assert.ok(selfRow.includes('data-self="true"'));
    },
  );
});

test('H12: 已登录 GET /users?notice=__proto__ → 200 且不渲染 notice（未知码忽略不变量）', async () => {
  const fixture = createFixture();
  const { token } = loginAlice(fixture.sessionAccess);
  await withServer({ sessionAccess: fixture.sessionAccess, usersPage: fixture.usersPage }, async (base) => {
    const res = await fetchNoRedirect(`${base}/users?notice=__proto__`, {
      headers: { cookie: `session_token=${token}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes('data-notice='));
    assert.ok(!html.includes('internal server error'));
    assert.ok(html.includes('alice'), '页面正常渲染用户列表');
  });
});

test('H11: 未注入 usersPage 的 FP-004 基线 /users 仍为占位内容', async () => {
  const { sessionAccess } = createFixture();
  const { token } = loginAlice(sessionAccess);
  await withServer({ sessionAccess }, async (base) => {
    const res = await fetchNoRedirect(`${base}/users`, {
      headers: { cookie: `session_token=${token}` },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('布局骨架占位'));
  });
});
