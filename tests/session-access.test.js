import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemorySessionStore } from '../src/session-store.js';
import {
  SESSION_COOKIE_NAME,
  createSessionAccess,
  parseCookies,
} from '../src/session-access.js';

const SECOND = 1000;

function fakeClock(startMs = 1_000_000) {
  let now = startMs;
  return { now: () => now, advance: (ms) => (now += ms) };
}

function requestWithCookie(cookieValue) {
  const headers = {};
  if (cookieValue !== undefined) headers.cookie = cookieValue;
  return { headers };
}

function cookieHeader(token) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

test('A1: createSessionOnLogin(1) 返回会话凭据且 store 可解析回 user_id', () => {
  const store = createMemorySessionStore();
  const access = createSessionAccess({ store });
  const session = access.createSessionOnLogin(1);
  assert.match(session.token, /^[0-9a-f]{64}$/);
  assert.equal(store.getSession(session.token).user_id, 1);
});

test('A2: token 随机不可预测 sanity（互异、hex64、与用户信息无关联）', () => {
  const store = createMemorySessionStore();
  const access = createSessionAccess({ store });
  const tokens = new Set();
  for (let i = 0; i < 200; i += 1) {
    const { token } = access.createSessionOnLogin(1);
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.ok(!token.includes('alice'), 'token 不应包含用户名');
    tokens.add(token);
  }
  assert.equal(tokens.size, 200, '全部 token 互异');
});

test('A3: 同一用户两次登录得到两个独立有效的 token', () => {
  const store = createMemorySessionStore();
  const access = createSessionAccess({ store });
  const first = access.createSessionOnLogin(1);
  const second = access.createSessionOnLogin(1);
  assert.notEqual(first.token, second.token);
  assert.equal(store.getSession(first.token).user_id, 1);
  assert.equal(store.getSession(second.token).user_id, 1);
});

test('A4: currentUser 携带有效凭据返回 {id, username}', () => {
  const store = createMemorySessionStore();
  const access = createSessionAccess({ store });
  const { token } = access.createSessionOnLogin(1);
  assert.deepEqual(access.currentUser(requestWithCookie(cookieHeader(token))), {
    id: 1,
    username: 'alice',
  });
});

test('A5: 无 Cookie / 缺键 / 空值 / 未知 token / 过期种子 token → null', () => {
  const access = createSessionAccess({ store: createMemorySessionStore() });
  assert.equal(access.currentUser(requestWithCookie(undefined)), null);
  assert.equal(access.currentUser(requestWithCookie('other=1')), null);
  assert.equal(
    access.currentUser(requestWithCookie(`${SESSION_COOKIE_NAME}=`)),
    null,
  );
  assert.equal(
    access.currentUser(requestWithCookie(cookieHeader('unknown-token'))),
    null,
  );
  assert.equal(
    access.currentUser(requestWithCookie(cookieHeader('seed-token-expired'))),
    null,
  );
});

test('A6: 孤儿会话（用户已不存在）currentUser 返回 null', () => {
  const store = createMemorySessionStore({ users: new Map() });
  const access = createSessionAccess({ store });
  const { token } = access.createSessionOnLogin(1);
  assert.equal(access.currentUser(requestWithCookie(cookieHeader(token))), null);
});

test('A7: Cookie 解析边界（多键 / 空格 / 缺 = / 重复键）', () => {
  assert.deepEqual(parseCookies('a=1; session_token=tok; b=2'), {
    a: '1',
    session_token: 'tok',
    b: '2',
  });
  assert.deepEqual(parseCookies('  a = 1 ;  b = 2 '), { a: '1', b: '2' });
  assert.deepEqual(parseCookies('novalue; a=1'), { a: '1' });
  assert.deepEqual(parseCookies('=x; a=1'), { a: '1' }, '空名片段安全跳过');
  const multi = parseCookies('a=1; a=2');
  assert.ok(multi.a === '1' || multi.a === '2');
  assert.deepEqual(parseCookies(undefined), {});
});

test('A8: logout 销毁会话且幂等', () => {
  const store = createMemorySessionStore();
  const access = createSessionAccess({ store });
  const { token } = access.createSessionOnLogin(1);
  access.logout(token);
  assert.equal(access.currentUser(requestWithCookie(cookieHeader(token))), null);
  access.logout(token);
  access.logout('never-existed');
});

test('A9: 会话过期后 currentUser 变 null（假时钟越过 TTL）', () => {
  const clock = fakeClock();
  const store = createMemorySessionStore({ now: clock.now, ttlMs: SECOND });
  const access = createSessionAccess({ store });
  const { token } = access.createSessionOnLogin(1);
  const request = requestWithCookie(cookieHeader(token));
  assert.equal(access.currentUser(request)?.username, 'alice');
  clock.advance(2 * SECOND);
  assert.equal(access.currentUser(request), null);
});

test('A10: sessionCookie 序列化含安全属性与 Max-Age', () => {
  const store = createMemorySessionStore();
  const access = createSessionAccess({ store });
  const session = access.createSessionOnLogin(1);
  const cookie = access.sessionCookie(session);
  assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  for (const attr of ['HttpOnly', 'SameSite=Lax', 'Path=/']) {
    assert.ok(cookie.includes(attr), `缺少 ${attr}`);
  }
  assert.match(cookie, /Max-Age=[1-9]\d*/);
});

test('A11: clearSessionCookie 立即清除浏览器侧凭据', () => {
  const access = createSessionAccess({ store: createMemorySessionStore() });
  const cookie = access.clearSessionCookie();
  assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  assert.ok(cookie.includes('Max-Age=0'));
});

test('A12: requireLogin 已登录放行且不写响应', () => {
  const store = createMemorySessionStore();
  const access = createSessionAccess({ store });
  const { token } = access.createSessionOnLogin(1);
  const response = {
    written: false,
    writeHead() {
      this.written = true;
    },
    end() {
      this.written = true;
    },
  };
  const user = access.requireLogin(requestWithCookie(cookieHeader(token)), response);
  assert.deepEqual(user, { id: 1, username: 'alice' });
  assert.equal(response.written, false);
});

test('A13: requireLogin 未登录写 302 跳转登录页并返回 null', () => {
  const access = createSessionAccess({ store: createMemorySessionStore() });
  const response = {
    status: 0,
    location: null,
    writeHead(status, headers) {
      this.status = status;
      this.location = headers.Location;
    },
    end() {},
  };
  const user = access.requireLogin(requestWithCookie(undefined), response);
  assert.equal(user, null);
  assert.equal(response.status, 302);
  assert.equal(response.location, '/login');
});
