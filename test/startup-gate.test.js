import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';

test('startup gate rejects before listening when health fails', async () => {
  const bridge = { health() { throw new Error('health unavailable'); } };
  await assert.rejects(
    startServer({ host: '127.0.0.1', port: 0, dataDir: '/tmp/fp-001-test-missing', bridge }),
    /health unavailable/,
  );
});

test('runtime bridge failure is translated to HTTP 503', async (t) => {
  let requests = 0;
  const bridge = {
    health() {},
    request() {
      requests += 1;
      if (requests === 1) return { version: 1, ok: true, result: { bootstrapped: true } };
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
