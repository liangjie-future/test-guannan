import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemorySocialStore } from '../src/social-store.js';
import { createFollowService } from '../src/follow-service.js';

function seedStore() {
  return createMemorySocialStore();
}

test('U1: 种子 listUsers 返回 alice/bob/carol（含 created_at，按 id 升序，返回副本）', () => {
  const store = seedStore();
  const users = store.listUsers();
  assert.deepEqual(
    users.map((u) => [u.id, u.username]),
    [
      [1, 'alice'],
      [2, 'bob'],
      [3, 'carol'],
    ],
  );
  for (const user of users) {
    assert.ok(typeof user.created_at === 'string' && user.created_at.length > 0);
  }
  users[0].username = 'mutated';
  assert.equal(store.listUsers()[0].username, 'alice', '返回值应为副本');
});

test('U2: 种子关注边：getFolloweeIds(1) → [2]；bob/未知用户 → []', () => {
  const store = seedStore();
  assert.deepEqual(store.getFolloweeIds(1), [2]);
  assert.deepEqual(store.getFolloweeIds(2), []);
  assert.deepEqual(store.getFolloweeIds(999), []);
});

test('U3: addFollow 建边且可查', () => {
  const store = seedStore();
  assert.equal(store.followExists(2, 3), false);
  store.addFollow(2, 3);
  assert.equal(store.followExists(2, 3), true);
  assert.deepEqual(store.getFolloweeIds(2), [3]);
});

test('U4: addFollow 幂等：同边重复写仍恰一条', () => {
  const store = seedStore();
  store.addFollow(2, 3);
  store.addFollow(2, 3);
  assert.deepEqual(store.getFolloweeIds(2), [3]);
});

test('U5: getUserById 命中与未知 id', () => {
  const store = seedStore();
  assert.equal(store.getUserById(1).username, 'alice');
  assert.equal(store.getUserById(999), null);
});

test('U6: 边单向不反向', () => {
  const store = seedStore();
  store.addFollow(2, 3);
  assert.equal(store.followExists(3, 2), false);
});

test('F1: follow(3,2) 未关注 → OK 新建，边落库', () => {
  const store = seedStore();
  const service = createFollowService({ store });
  assert.deepEqual(service.follow(3, 2), { status: 'OK', created: true });
  assert.equal(store.followExists(3, 2), true);
});

test('F2: follow(2,3) 种子已关注 → OK 幂等（created:false，仍一条边）', () => {
  const store = seedStore();
  const service = createFollowService({ store });
  assert.deepEqual(service.follow(1, 2), { status: 'OK', created: false });
  assert.deepEqual(store.getFolloweeIds(1), [2]);
});

test('F3: follow(1,1) 自关注 → 拒绝，不产生边', () => {
  const store = seedStore();
  const service = createFollowService({ store });
  assert.deepEqual(service.follow(1, 1), {
    status: 'ERROR',
    reason: 'SELF_FOLLOW_NOT_ALLOWED',
  });
  assert.equal(store.followExists(1, 1), false);
});

test('F4: follow(1,999) 被关注者不存在 → 拒绝，不产生边', () => {
  const store = seedStore();
  const service = createFollowService({ store });
  assert.deepEqual(service.follow(1, 999), {
    status: 'ERROR',
    reason: 'FOLLOWEE_NOT_FOUND',
  });
  assert.deepEqual(store.getFolloweeIds(1), [2]);
});

test('F5: getFolloweeIds 为页面已关注态数据来源（种子 [2]）', () => {
  const service = createFollowService({ store: seedStore() });
  assert.deepEqual(service.getFolloweeIds(1), [2]);
});
