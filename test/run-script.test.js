import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_SCRIPT = path.join(APP_ROOT, 'run');

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fp005-e2e-${label}-`));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// 运行 run 脚本并等待退出，返回 {code, signal, stdout, stderr}
function runScript(args, { env = {}, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [RUN_SCRIPT, ...args], {
      cwd: APP_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`run ${args.join(' ')} 超时\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function waitForOk(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch { /* 未就绪，继续轮询 */ }
    if (Date.now() > deadline) throw new Error(`服务在 ${timeoutMs}ms 内未就绪: ${url}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function waitForRefused(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    if (Date.now() > deadline) throw new Error(`超 ${timeoutMs}ms 端口仍可连接: ${url}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function waitExit(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('子进程未按预期退出')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function startForeground(t, { port, dataDir, envFile }) {
  const child = spawn('bash', [RUN_SCRIPT, 'start', '--foreground'], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      ...(envFile ? { RUN_ENV_FILE: envFile } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  return { child, getStderr: () => stderr };
}

test('R1+R2+R3: 前台启动可达、SIGTERM 优雅退出、端口释放后可再启动', { timeout: 30000 }, async (t) => {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}/`;
  const dataDir = path.join(tmpDir('fg'), 'data');

  // R1: 前台启动，GET / 返回 200 且含 FP-004 页面骨架
  const first = await startForeground(t, { port, dataDir });
  const res = await waitForOk(url);
  assert.match(await res.text(), /页面骨架演示页/);

  // R2: SIGTERM 优雅退出（退出码 0），随后端口连接被拒
  first.child.kill('SIGTERM');
  const exited = await waitExit(first.child);
  assert.equal(exited.code, 0, `stderr: ${first.getStderr()}`);
  await waitForRefused(url);

  // R3: 同端口再启动仍 200（重启后 DATA_DIR 仍在且可复用）
  assert.ok(fs.statSync(dataDir).isDirectory(), 'DATA_DIR 应保留');
  const second = await startForeground(t, { port, dataDir });
  const res2 = await waitForOk(url);
  assert.equal(res2.status, 200);
  second.child.kill('SIGTERM');
  await waitExit(second.child);
});

test('R4+R5: run config 输出恰三项；.env 白名单加载且环境变量优先', { timeout: 15000 }, async () => {
  const dir = tmpDir('config');
  const envFile = path.join(dir, 'env');
  fs.writeFileSync(envFile, [
    '# 注释行应被忽略',
    'PORT=14567',
    'HOST=127.0.0.1',
    'DATA_DIR=./var/from-env-file',
    'TENANT_ID=tenant-1',
    'ENVIRONMENT=production',
    'MULTI_TENANT=true',
    '',
  ].join('\n'));

  // 无环境变量：全部来自 .env（白名单内的三项）
  const fromFile = await runScript(['config'], { env: { RUN_ENV_FILE: envFile } });
  assert.equal(fromFile.code, 0, fromFile.stderr);
  const lines = fromFile.stdout.trim().split('\n').sort();
  assert.equal(lines.length, 3, `应恰好 3 行配置: ${lines}`);
  assert.deepEqual(lines, [
    `DATA_DIR=${path.join(APP_ROOT, 'var/from-env-file')}`,
    'HOST=127.0.0.1',
    'PORT=14567',
  ]);

  // 环境变量优先于 .env
  const fromEnv = await runScript(['config'], {
    env: { RUN_ENV_FILE: envFile, PORT: '15999', HOST: '0.0.0.0' },
  });
  assert.equal(fromEnv.code, 0, fromEnv.stderr);
  assert.match(fromEnv.stdout, /PORT=15999/);
  assert.match(fromEnv.stdout, /HOST=0\.0\.0\.0/);
});

test('R6: 守护模式 start/status/stop 生命周期与探活', { timeout: 30000 }, async (t) => {
  const dir = tmpDir('daemon');
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}/`;
  const env = {
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: path.join(dir, 'data'),
    RUN_PID_FILE: path.join(dir, 'app.pid'),
    RUN_LOG_FILE: path.join(dir, 'app.log'),
  };
  const pidFile = env.RUN_PID_FILE;

  const stopDaemon = async () => {
    await runScript(['stop'], { env });
  };
  t.after(() => { void stopDaemon(); });

  // start：退出码 0，且完成探活后服务确实可达
  const started = await runScript(['start'], { env });
  assert.equal(started.code, 0, `stdout:${started.stdout}\nstderr:${started.stderr}`);
  assert.ok(fs.existsSync(pidFile), '应写入 PID 文件');
  const res = await waitForOk(url);
  assert.match(await res.text(), /页面骨架演示页/);

  // status：运行中退出码 0
  const statusUp = await runScript(['status'], { env });
  assert.equal(statusUp.code, 0);
  assert.match(statusUp.stdout, /running/);

  // stop：退出码 0（优雅停止，不应升级 SIGKILL）；之后 status 退出码 3、端口释放、PID 文件清理
  const stopped = await runScript(['stop'], { env });
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.match(stopped.stdout, /已停止/);
  assert.doesNotMatch(stopped.stdout, /SIGKILL|强制/);
  assert.ok(!fs.existsSync(pidFile), '停止后应清理 PID 文件');
  const statusDown = await runScript(['status'], { env });
  assert.equal(statusDown.code, 3);
  await waitForRefused(url);
});

test('R7: stop 幂等——无进程与陈旧 PID 文件均退出码 0', { timeout: 15000 }, async () => {
  const dir = tmpDir('idempotent');
  const env = { RUN_PID_FILE: path.join(dir, 'app.pid') };

  const noProcess = await runScript(['stop'], { env });
  assert.equal(noProcess.code, 0, noProcess.stderr);

  fs.writeFileSync(env.RUN_PID_FILE, '99999999');
  const stale = await runScript(['stop'], { env });
  assert.equal(stale.code, 0, stale.stderr);
  assert.ok(!fs.existsSync(env.RUN_PID_FILE), '陈旧 PID 文件应被清理');
});

test('R8: 守护模式拒绝 PORT=0 并给出明确错误', { timeout: 15000 }, async () => {
  const dir = tmpDir('port0');
  const result = await runScript(['start'], {
    env: {
      HOST: '127.0.0.1',
      PORT: '0',
      DATA_DIR: path.join(dir, 'data'),
      RUN_PID_FILE: path.join(dir, 'app.pid'),
      RUN_LOG_FILE: path.join(dir, 'app.log'),
    },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /PORT=0/);
});
