import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import { createPythonBridge } from '../src/python-bridge.js';
import { createRealSocialService } from '../src/real-social-service.js';
import { startServer } from '../src/server.js';

function dataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fp003-real-'));
}

async function closeServer(server) {
  if (server.listening) server.closeIdleConnections();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function realSocial() {
  const dir = dataDir();
  const social = createRealSocialService(createPythonBridge({ dataDir: dir }));
  const alice = social.register('alice', 'alice-password');
  const bob = social.register('bob', 'bob-password');
  const carol = social.register('carol', 'carol-password');
  return { dir, social, alice, bob, carol };
}

test('FP-003 real post derives author from the Python session and trims content', () => {
  const { social, alice } = realSocial();
  const result = social.createPost(alice.session_token, '  hello from alice  ');

  assert.equal(result.status, 'OK');
  assert.equal(result.post.author_id, alice.user.id);
  assert.equal(result.post.content, 'hello from alice');
  assert.ok(result.post.created_at);
});

test('FP-003 real post enforces empty, 280, and 281 Unicode code-point boundaries', () => {
  const { social, alice } = realSocial();
  assert.deepEqual(social.createPost(alice.session_token, ' \n\t '), {
    status: 'ERROR',
    reason: 'EMPTY_CONTENT',
  });
  assert.equal(social.createPost(alice.session_token, `  ${'𝕒'.repeat(280)}  `).status, 'OK');
  assert.deepEqual(social.createPost(alice.session_token, '𝕒'.repeat(281)), {
    status: 'ERROR',
    reason: 'TOO_LONG',
  });
});

test('FP-003 real timeline uses follows, excludes self, and preserves descending service order', () => {
  const { social, alice, bob, carol } = realSocial();
  social.follow(alice.session_token, bob.user.id);
  social.createPost(alice.session_token, 'alice own');
  social.createPost(bob.session_token, 'bob visible');
  social.createPost(carol.session_token, 'carol hidden');

  const timeline = social.getTimeline(alice.session_token);
  assert.deepEqual(timeline.map((post) => post.content), ['bob visible']);
  assert.equal(timeline[0].author_username, 'bob');
});

test('FP-003 invalid session cannot publish and has no timeline identity', () => {
  const { social } = realSocial();
  assert.deepEqual(social.createPost('not-a-session', 'should not persist'), {
    status: 'ERROR',
    reason: 'UNAUTHENTICATED',
  });
  assert.deepEqual(social.getTimeline('not-a-session'), []);
});

test('FP-003 production HTTP compose and timeline use the same real SQLite database', async (t) => {
  const dir = dataDir();
  const handle = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  t.after(() => closeServer(handle.server));
  const social = createRealSocialService(createPythonBridge({ dataDir: dir }));
  const alice = social.register('alice', 'alice-password');
  const bob = social.register('bob', 'bob-password');
  social.follow(alice.session_token, bob.user.id);

  const post = await fetch(`${handle.url}compose`, {
    method: 'POST',
    headers: { cookie: `session_token=${bob.session_token}` },
    body: new URLSearchParams({ content: 'bob through HTTP' }),
  });
  assert.equal(post.status, 200);
  assert.match(await post.text(), /data-result="OK"/);

  const timeline = await fetch(`${handle.url}timeline`, {
    headers: { cookie: `session_token=${alice.session_token}` },
  });
  assert.equal(timeline.status, 200);
  const html = await timeline.text();
  assert.match(html, /bob through HTTP/);
  assert.doesNotMatch(html, /alice through HTTP/);
});

test('FP-003 fresh production startup does not create demo users or posts', async (t) => {
  const dir = dataDir();
  const handle = await startServer({ host: '127.0.0.1', port: 0, dataDir: dir });
  t.after(() => closeServer(handle.server));

  assert.equal(fs.existsSync(path.join(dir, 'social.db')), true);
  const response = await fetch(`${handle.url}timeline`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');
  assert.equal(createRealSocialService(createPythonBridge({ dataDir: dir })).currentUser('seed-token-1'), null);
});
