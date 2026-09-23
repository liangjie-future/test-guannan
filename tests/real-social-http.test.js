import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../src/server.js';
import { PythonBridgeError } from '../src/python-bridge.js';

function createBridge(failingOperation) {
  return {
    health() {
      return {};
    },
    request(operation) {
      if (operation === failingOperation) {
        throw new PythonBridgeError(`${operation} failed`, 'SERVICE_ERROR');
      }
      if (operation === 'current_user') return { user: { id: 1, username: 'alice' } };
      if (operation === 'list_users') return { users: [{ id: 1, username: 'alice' }], followee_ids: [] };
      if (operation === 'follow') return { status: 'OK', created: true };
      if (operation === 'logout') return {};
      throw new Error(`unexpected operation: ${operation}`);
    },
  };
}

async function withProductionServer(failingOperation, run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-social-http-'));
  const handle = await startServer({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    bridge: createBridge(failingOperation),
  });
  try {
    await run(handle.url);
  } finally {
    await new Promise((resolve, reject) => handle.server.close((error) => (error ? reject(error) : resolve())));
  }
}

const cookie = { headers: { cookie: 'session_token=real-token' } };

test('real current-user bridge failures return HTTP 503', async () => {
  await withProductionServer('current_user', async (base) => {
    const response = await fetch(`${base}users`, { ...cookie, redirect: 'manual' });
    assert.equal(response.status, 503);
  });
});

test('real list-users bridge failures return HTTP 503 from /users', async () => {
  await withProductionServer('list_users', async (base) => {
    const response = await fetch(`${base}users`, { ...cookie, redirect: 'manual' });
    assert.equal(response.status, 503);
  });
});

test('real follow bridge failures return HTTP 503', async () => {
  await withProductionServer('follow', async (base) => {
    const response = await fetch(`${base}users/2/follow`, {
      ...cookie,
      method: 'POST',
      redirect: 'manual',
    });
    assert.equal(response.status, 503);
  });
});

test('real logout bridge failures return HTTP 503', async () => {
  await withProductionServer('logout', async (base) => {
    const response = await fetch(`${base}logout`, { ...cookie, redirect: 'manual' });
    assert.equal(response.status, 503);
  });
});
