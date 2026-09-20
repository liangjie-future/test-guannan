import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * FP-005 单机部署运行配置（Node 侧唯一配置来源）。
 * 契约：仅 HOST / PORT / DATA_DIR 三项（单环境、单租户，无多环境/多租户开关）。
 * 来源优先级：环境变量 > .env 文件（由 run 脚本白名单加载）> 默认值。
 */

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_DATA_DIR = './data';

const CONFIG_KEYS = ['HOST', 'PORT', 'DATA_DIR'];

function readString(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw;
}

function readPort(env) {
  const raw = env.PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const text = String(raw).trim();
  const port = Number(text);
  if (!/^\d{1,5}$/.test(text) || port > 65535) {
    throw new Error(`Invalid PORT: ${JSON.stringify(raw)} (expected integer 0-65535)`);
  }
  return port;
}

function loadConfig(env = process.env) {
  const config = {
    host: readString(env, 'HOST', DEFAULT_HOST),
    port: readPort(env),
    dataDir: path.resolve(APP_ROOT, readString(env, 'DATA_DIR', DEFAULT_DATA_DIR)),
  };
  return Object.freeze(config);
}

export {
  APP_ROOT,
  CONFIG_KEYS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_DATA_DIR,
  loadConfig,
};
