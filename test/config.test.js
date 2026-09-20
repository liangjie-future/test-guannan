import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, CONFIG_KEYS } from '../src/config.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('C1: 空环境变量时使用默认值（127.0.0.1 / 3000 / <仓库根>/data）', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.equal(config.dataDir, path.join(APP_ROOT, 'data'));
  assert.ok(path.isAbsolute(config.dataDir));
});

test('C2: 环境变量覆盖 HOST / PORT / DATA_DIR；相对 DATA_DIR 相对仓库根解析', () => {
  const config = loadConfig({
    HOST: '0.0.0.0',
    PORT: '8080',
    DATA_DIR: './var/my-data',
  });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8080);
  assert.equal(config.dataDir, path.join(APP_ROOT, 'var/my-data'));

  const absolute = loadConfig({ DATA_DIR: '/srv/app-data' });
  assert.equal(absolute.dataDir, '/srv/app-data');
});

test('C3: PORT 边界值 0 / 1 / 65535 合法', () => {
  assert.equal(loadConfig({ PORT: '0' }).port, 0);
  assert.equal(loadConfig({ PORT: '1' }).port, 1);
  assert.equal(loadConfig({ PORT: '65535' }).port, 65535);
});

test('C4: 非法 PORT 报错并指明原因', () => {
  for (const bad of ['abc', '1.5', '-1', '70000', '65536', '3000.0', '+3000', '0x10', '']) {
    if (bad === '') continue; // 空串回落默认值，由 C5 覆盖
    assert.throws(
      () => loadConfig({ PORT: bad }),
      /PORT/,
      `PORT=${bad} 应被拒绝`,
    );
  }
  // 合法：纯数字字符串（含前后空白）与数字类型
  assert.equal(loadConfig({ PORT: ' 3000 ' }).port, 3000);
  assert.equal(loadConfig({ PORT: 3000 }).port, 3000);
});

test('C5: 空字符串环境变量视同未设置，回落默认值', () => {
  const config = loadConfig({ HOST: '', PORT: '', DATA_DIR: '' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.equal(config.dataDir, path.join(APP_ROOT, 'data'));
});

test('C6: 配置键集合恰为 HOST / PORT / DATA_DIR（无多环境/多租户开关）', () => {
  const config = loadConfig({
    HOST: '127.0.0.1',
    PORT: '3000',
    DATA_DIR: './data',
    ENVIRONMENT: 'production',
    ENV: 'prod',
    TENANT_ID: 'tenant-1',
    MULTI_TENANT: 'true',
    APP_ENV: 'staging',
  });
  assert.deepEqual(Object.keys(config).sort(), ['dataDir', 'host', 'port']);
  assert.deepEqual(CONFIG_KEYS, ['HOST', 'PORT', 'DATA_DIR']);
});

test('C7: 配置对象不可变', () => {
  const config = loadConfig({});
  assert.throws(() => {
    'use strict';
    config.port = 12345;
  });
});
