import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemorySessionStore } from '../src/session-store.js';

const SECOND = 1000;

function fakeClock(startMs = 1_000_000) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

test('U1: createSession 返回 {token, expires_at}，expires_at 为未来 ISO 时刻', () => {
  const clock = fakeClock();
  const store = createMemorySessionStore({ now: clock.now, ttlMs: 60 * SECOND });
  const session = store.createSession(1);
  assert.match(session.token, /^[0-9a-f]{64}$/);
  assert.equal(typeof session.expires_at, 'string');
  assert.equal(Date.parse(session.expires_at), clock.now() + 60 * SECOND);
});

test('U2: 有效 token getSession 返回 {user_id, expires_at}', () => {
  const store = createMemorySessionStore();
  const { token, expires_at } = store.createSession(1);
  assert.deepEqual(store.getSession(token), { user_id: 1, expires_at });
});

test('U3: 未知 token getSession 返回 null', () => {
  const store = createMemorySessionStore();
  assert.equal(store.getSession('no-such-token'), null);
});

test('U4: 过期 token 返回 null 且惰性清理', () => {
  const clock = fakeClock();
  const store = createMemorySessionStore({ now: clock.now, ttlMs: SECOND });
  const { token } = store.createSession(1);
  clock.advance(2 * SECOND);
  assert.equal(store.getSession(token), null);
  clock.advance(2 * SECOND);
  assert.equal(store.getSession(token), null, '重复查询仍为 null（清理后无残留）');
});

test('U5: expires_at 恰等于当前时刻视为过期（<= 边界）', () => {
  const clock = fakeClock();
  const store = createMemorySessionStore({ now: clock.now, ttlMs: SECOND });
  const { token } = store.createSession(1);
  clock.advance(SECOND);
  assert.equal(store.getSession(token), null);
});

test('U6: destroySession 幂等且销毁后立即失效', () => {
  const store = createMemorySessionStore();
  const { token } = store.createSession(1);
  store.destroySession(token);
  assert.equal(store.getSession(token), null);
  store.destroySession(token);
  store.destroySession('never-existed');
  assert.equal(store.getSession(token), null);
});

test('U7: getUserById 返回种子用户 alice，未知 id 返回 null', () => {
  const store = createMemorySessionStore();
  const alice = store.getUserById(1);
  assert.equal(alice.username, 'alice');
  assert.equal(alice.id, 1);
  assert.equal(store.getUserById(99999), null);
});

test('U8: 种子会话 seed-token-1 有效、seed-token-expired 已过期', () => {
  const store = createMemorySessionStore();
  assert.equal(store.getSession('seed-token-1')?.user_id, 1);
  assert.equal(store.getSession('seed-token-expired'), null);
});
