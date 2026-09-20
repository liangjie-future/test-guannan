import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCurrentUser } from '../src/current-user.js';

test('C1: 默认 currentUser 注入点对任意请求返回 null（FP-003 未合入基线）', () => {
  assert.equal(defaultCurrentUser({ url: '/' }), null);
});
