import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, 'python_worker.py');
const LIMIT = 1024 * 1024;

export class PythonBridgeError extends Error {
  constructor(message, code = 'BRIDGE_ERROR') {
    super(message);
    this.name = 'PythonBridgeError';
    this.code = code;
  }
}

function sizeOf(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

export function createPythonBridge({ dataDir, pythonBin = process.env.PYTHON_BIN ?? 'python3', worker = WORKER, spawnSyncImpl = spawnSync } = {}) {
  if (!path.isAbsolute(dataDir)) throw new TypeError('python bridge dataDir must be absolute');
  const dbPath = path.join(dataDir, 'social.db');
  function request(operation, payload = {}) {
    const input = `${JSON.stringify({ version: 1, operation, payload, db_path: dbPath })}\n`;
    let child;
    try {
      child = spawnSyncImpl(pythonBin, [worker], {
        input,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: LIMIT,
      });
    } catch (error) {
      throw new PythonBridgeError('python bridge failed', 'BRIDGE_ERROR');
    }
    if (sizeOf(child.stdout) > LIMIT || sizeOf(child.stderr) > LIMIT) {
      throw new PythonBridgeError('python bridge output exceeded limit', 'OUTPUT_LIMIT');
    }
    if (child.error || child.status !== 0) {
      throw new PythonBridgeError('python bridge process failed', child.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'PROCESS_ERROR');
    }
    let response;
    try {
      response = JSON.parse(child.stdout);
    } catch {
      throw new PythonBridgeError('python bridge returned invalid JSON', 'PROTOCOL_ERROR');
    }
    if (response?.version !== 1 || typeof response.ok !== 'boolean' || (response.ok && !('result' in response)) || (!response.ok && !response.error)) {
      throw new PythonBridgeError('python bridge returned invalid envelope', 'PROTOCOL_ERROR');
    }
    if (!response.ok) throw new PythonBridgeError(response.error.message || 'python service failed', response.error.code || 'SERVICE_ERROR');
    return response.result;
  }
  return { request, health: () => request('health') };
}
