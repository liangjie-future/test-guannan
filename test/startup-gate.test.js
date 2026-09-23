import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { createPythonBridge } from '../src/python-bridge.js';

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('fresh startup leaves users, posts, and sessions empty after health', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-001-empty-start-'));
  const handle = await startServer({ host: '127.0.0.1', port: 0, dataDir });
  t.after(() => closeServer(handle.server));

  const bridge = createPythonBridge({ dataDir });
  assert.deepEqual(bridge.request('list_users').users, []);
  assert.deepEqual(bridge.request('timeline', { user_id: 1 }).posts, []);
  assert.equal(bridge.request('get_session', { token: 'seed-token-1' }).session, null);
});

test('startup gate rejects before listening when health fails', async () => {
  const bridge = { health() { throw new Error('health unavailable'); } };
  await assert.rejects(
    startServer({ host: '127.0.0.1', port: 0, dataDir: '/tmp/fp-001-test-missing', bridge }),
    /health unavailable/,
  );
});

test('runtime bridge failure is translated to HTTP 503', async (t) => {
  const bridge = {
    health() {},
    request() {
      const error = new Error('python unavailable');
      error.statusCode = 503;
      throw error;
    },
  };
  const handle = await startServer({ host: '127.0.0.1', port: 0, dataDir: '/tmp/fp-001-runtime-failure', bridge });
  t.after(() => new Promise((resolve) => handle.server.close(resolve)));
  const response = await fetch(`${handle.url}login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=bob&password=right-password',
  });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /python unavailable/);
});
