import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPythonBridge } from '../src/python-bridge.js';
import { createRealSocialService } from '../src/real-social-service.js';

test('FP-002 real Python auth, session, users and follow survive the worker boundary', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp002-real-'));
  const social = createRealSocialService(createPythonBridge({ dataDir }));

  const alice = social.register('alice', 'alice-password');
  const bob = social.register('bob', 'bob-password');
  assert.equal(alice.status, 'OK');
  assert.equal(bob.status, 'OK');
  assert.notEqual(alice.session_token, bob.session_token);
  assert.ok(alice.expires_at);
  assert.deepEqual(social.currentUser(alice.session_token), alice.user);

  const first = social.follow(alice.session_token, bob.user.id);
  const second = social.follow(alice.session_token, bob.user.id);
  assert.deepEqual(first, { status: 'OK', created: true });
  assert.deepEqual(second, { status: 'OK', created: false });

  const listed = social.listUsers(alice.session_token);
  assert.deepEqual(listed.followee_ids, [bob.user.id]);
  assert.deepEqual(listed.users.map(({ username }) => username), ['alice', 'bob']);
  assert.deepEqual(social.follow(alice.session_token, alice.user.id), {
    status: 'ERROR',
    reason: 'SELF_FOLLOW_NOT_ALLOWED',
  });

  social.logout(alice.session_token);
  assert.equal(social.currentUser(alice.session_token), null);
});
