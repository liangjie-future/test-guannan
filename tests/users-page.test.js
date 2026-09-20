import test from 'node:test';
import assert from 'node:assert/strict';

import { createUsersPage } from '../src/users-page.js';

const alice = { id: 1, username: 'alice' };

function seedUsers() {
  return [
    { id: 1, username: 'alice', created_at: '2026-01-01T00:00:00.000Z' },
    { id: 2, username: 'bob', created_at: '2026-01-02T00:00:00.000Z' },
    { id: 3, username: 'carol', created_at: '2026-01-03T00:00:00.000Z' },
  ];
}

/** 记录型 Mock（任务卡 §6）：记录调用，委托真实三态实现。 */
function createFixture({ users = seedUsers(), followeeIds = [2], followImpl } = {}) {
  const calls = [];
  const follow = (followerId, followeeId) => {
    calls.push([followerId, followeeId]);
    if (followImpl) return followImpl(followerId, followeeId);
    return { status: 'OK', created: true };
  };
  const page = createUsersPage({
    listUsers: () => users.map((u) => ({ ...u })),
    follow,
    getFolloweeIds: () => [...followeeIds],
  });
  return { page, calls };
}

function rowOf(html, userId) {
  const match = html.match(new RegExp(`<tr[^>]*data-user-id="${userId}"[^>]*>[^]*?</tr>`));
  return match ? match[0] : null;
}

test('P1: alice + 种子渲染 3 用户全展示，行带 data-user-id，section 包裹', () => {
  const { page } = createFixture();
  const html = page.renderContent({ currentUser: alice });
  assert.match(html, /^<section/);
  for (const name of ['alice', 'bob', 'carol']) {
    assert.ok(html.includes(name), `缺少用户 ${name}`);
  }
  for (const id of [1, 2, 3]) {
    assert.ok(rowOf(html, id), `缺少用户行 ${id}`);
  }
});

test('P2: 自己行有区分标识（data-self + 可见徽标），他人行无', () => {
  const { page } = createFixture();
  const html = page.renderContent({ currentUser: alice });
  const selfRow = rowOf(html, 1);
  assert.ok(selfRow.includes('data-self="true"'));
  assert.ok(selfRow.includes('（我）'));
  for (const id of [2, 3]) {
    assert.ok(!rowOf(html, id).includes('data-self='));
  }
});

test('P3: 自己行无可用关注操作（无 form/button），他人行均有关注按钮', () => {
  const { page } = createFixture();
  const html = page.renderContent({ currentUser: alice });
  const selfRow = rowOf(html, 1);
  assert.ok(!selfRow.includes('<form'));
  assert.ok(!selfRow.includes('<button'));
  for (const id of [2, 3]) {
    const row = rowOf(html, id);
    assert.ok(row.includes('<form'), `行 ${id} 应有关注表单`);
    assert.ok(row.includes('<button'), `行 ${id} 应有关注按钮`);
    assert.ok(row.includes(`action="/users/${id}/follow"`), `行 ${id} 表单目标`);
  }
});

test('P4: 已关注态按钮标签随状态区分', () => {
  const { page } = createFixture();
  const html = page.renderContent({ currentUser: alice });
  assert.ok(rowOf(html, 2).includes('data-follow-state="following"'));
  assert.ok(rowOf(html, 2).includes('已关注'));
  assert.ok(rowOf(html, 3).includes('data-follow-state="not-following"'));
  assert.ok(rowOf(html, 3).includes('关注'));
});

test('P5: 关注动作以 (1,3) 调用 follow，返回 303 目标含成功反馈', () => {
  const { page, calls } = createFixture();
  const result = page.handleFollowAction({ currentUser: alice, followeeId: 3 });
  assert.deepEqual(calls, [[1, 3]]);
  assert.equal(result.status, 303);
  assert.equal(result.location, '/users?notice=FOLLOW_OK&username=carol');
});

test('P6: 自关注动作被拒（服务端兜底），返回 SELF_FOLLOW_NOT_ALLOWED', () => {
  const { page, calls } = createFixture({
    followImpl: () => ({ status: 'ERROR', reason: 'SELF_FOLLOW_NOT_ALLOWED' }),
  });
  const result = page.handleFollowAction({ currentUser: alice, followeeId: 1 });
  assert.deepEqual(calls, [[1, 1]]);
  assert.equal(result.status, 303);
  assert.equal(result.location, '/users?notice=SELF_FOLLOW_NOT_ALLOWED');
});

test('P7: 不存在用户动作返回 FOLLOWEE_NOT_FOUND', () => {
  const { page } = createFixture({
    followImpl: () => ({ status: 'ERROR', reason: 'FOLLOWEE_NOT_FOUND' }),
  });
  const result = page.handleFollowAction({ currentUser: alice, followeeId: 999 });
  assert.equal(result.location, '/users?notice=FOLLOWEE_NOT_FOUND');
});

test('P8: notice 渲染已知码，未知码忽略（无反射面）', () => {
  const { page } = createFixture();
  const ok = page.renderContent({
    currentUser: alice,
    searchParams: new URLSearchParams('notice=FOLLOW_OK&username=carol'),
  });
  assert.ok(ok.includes('data-notice="FOLLOW_OK"'));
  assert.ok(ok.includes('已关注 carol'));

  const unknown = page.renderContent({
    currentUser: alice,
    searchParams: new URLSearchParams('notice=<script>alert(1)</script>'),
  });
  assert.ok(!unknown.includes('data-notice='));
  assert.ok(!unknown.includes('<script>'));
});

test('P9: 用户名与 notice username 均被转义（XSS）', () => {
  const { page } = createFixture({
    users: [{ id: 2, username: '<script>bob()</script>', created_at: '2026-01-02T00:00:00.000Z' }],
    followeeIds: [],
  });
  const html = page.renderContent({
    currentUser: alice,
    searchParams: new URLSearchParams('notice=FOLLOW_OK&username=<i>x</i>'),
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<i>x</i>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('P10: 空用户列表渲染空态不崩溃', () => {
  const { page } = createFixture({ users: [], followeeIds: [] });
  const html = page.renderContent({ currentUser: alice });
  assert.ok(html.includes('暂无'));
});
