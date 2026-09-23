import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPythonBridge, PythonBridgeError } from '../src/python-bridge.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp001-bridge-'));

function runner(result) {
  return () => ({ stdout: JSON.stringify(result), stderr: '', status: 0, error: undefined });
}

test('bridge parses a successful versioned envelope', () => {
  const bridge = createPythonBridge({ dataDir, spawnSyncImpl: runner({ version: 1, ok: true, result: { healthy: true } }) });
  assert.deepEqual(bridge.request('health', {}), { healthy: true });
});

test('bridge rejects malformed JSON, timeout, non-zero exit, and oversized output', () => {
  for (const result of [
    { stdout: '{', stderr: '', status: 0 },
    { stdout: '', stderr: '', status: 1 },
    { stdout: '', stderr: '', status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) },
    { stdout: 'x'.repeat(1024 * 1024), stderr: '', status: 0 },
  ]) {
    const bridge = createPythonBridge({ dataDir, spawnSyncImpl: runner(result) });
    assert.throws(() => bridge.request('health', {}), PythonBridgeError);
  }
});
