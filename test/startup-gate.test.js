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
