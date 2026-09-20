import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UNIFIED_LOGIN_ERROR_MESSAGE,
  createMockLoginService,
} from '../src/login-mock.js';

test('M1: bob / right-password → OK 契约形状（恰三键、session_token 非空）', () => {
  const login = createMockLoginService();
  const result = login('bob', 'right-password');

  assert.deepEqual(Object.keys(result).sort(), ['session_token', 'status', 'user']);
  assert.equal(result.status, 'OK');
  assert.deepEqual(Object.keys(result.user).sort(), ['id', 'username']);
  assert.equal(result.user.username, 'bob');
  assert.equal(typeof result.session_token, 'string');
  assert.ok(result.session_token.length > 0);
  assert.ok(!JSON.stringify(result).includes('right-password'), '明文密码不进响应');
});

test('M2: 错误密码 / 未知用户名 → 统一失败（恰两键，无 session_token）', () => {
  const login = createMockLoginService();

  for (const [username, password] of [['bob', 'wrong-password'], ['ghost', 'right-password']]) {
    const result = login(username, password);
    assert.deepEqual(result, {
      status: 'ERROR',
      message: UNIFIED_LOGIN_ERROR_MESSAGE,
    }, `${username}/${password} 应统一失败`);
  }
});

test('M3: 两失败场景响应不可区分（深相等）', () => {
  const login = createMockLoginService();
  assert.deepEqual(login('bob', 'wrong-password'), login('ghost', 'anything'));
});

test('M4: 非字符串输入 → 统一失败、不抛异常', () => {
  const login = createMockLoginService();
  for (const [username, password] of [[null, 'x'], ['bob', 123], [undefined, undefined]]) {
    assert.deepEqual(login(username, password), {
      status: 'ERROR',
      message: UNIFIED_LOGIN_ERROR_MESSAGE,
    });
  }
});

test('M5: 自定义 accounts 注入按注入表判定（可替换性）', () => {
  const login = createMockLoginService({
    accounts: [{ id: 9, username: 'carol', password: 'secret123' }],
  });

  assert.equal(login('carol', 'secret123').status, 'OK');
  assert.equal(login('bob', 'right-password').status, 'ERROR');
});

test('M6: 注入 createSessionOnLogin → 恰一次调用且 token 归一', () => {
  const calls = [];
  const login = createMockLoginService({
    createSessionOnLogin: (userId) => {
      calls.push(userId);
      return calls.length === 1
        ? { token: 'dict-form-token', expires_at: '2099-01-01T00:00:00.000Z' }
        : 'string-form-token';
    },
  });

  assert.equal(login('bob', 'right-password').session_token, 'dict-form-token');
  assert.equal(login('bob', 'right-password').session_token, 'string-form-token');
  assert.deepEqual(calls, [2, 2], '恰各一次且入参为账号 id');
  assert.equal(login('bob', 'wrong-password').session_token, undefined);
  assert.deepEqual(calls, [2, 2], '失败不触达会话工厂');
});
