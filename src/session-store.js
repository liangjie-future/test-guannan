import { randomBytes } from 'node:crypto';

/**
 * FP-003 会话存取原语适配层（任务卡 §3.2 依赖契约的 Node 侧消费端）。
 *
 * FP-001 的持久化实现是 Python SQLite 层，Node Web 进程无法进程内调用；
 * 此处按同一契约提供内存 Map 默认实现（§6 Mock 策略），并内置验证用
 * 种子数据（alice / seed-token-1 / seed-token-expired）。后续持久化桥接
 * 属集成点：替换注入的 store 即可，会话逻辑零改动。
 */

/** 与 FP-001 DEFAULT_SESSION_TTL（7 天）对齐。 */
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isoTime(ms) {
  return new Date(ms).toISOString();
}

/** 种子用户表（alice）；导出供组装点扩展（如 FP-008 增补登录替身 bob）。 */
export function seedUsers(nowMs) {
  const createdAt = isoTime(nowMs);
  return new Map([
    [1, {
      id: 1,
      username: 'alice',
      password_hash: 'hash-alice-placeholder',
      salt: 'salt-alice-placeholder',
      created_at: createdAt,
    }],
  ]);
}

function seedSessions(nowMs, ttlMs) {
  return new Map([
    ['seed-token-1', { user_id: 1, expires_at: isoTime(nowMs + ttlMs) }],
    ['seed-token-expired', { user_id: 1, expires_at: isoTime(nowMs - 1000) }],
  ]);
}

/**
 * 内存版会话存取原语（契约同 FP-001 §3.2）：
 * createSession / getSession / destroySession / getUserById。
 * now 与 ttlMs 可注入，供测试以假时钟确定性地验证过期语义。
 */
export function createMemorySessionStore({
  ttlMs = DEFAULT_SESSION_TTL_MS,
  now = () => Date.now(),
  users = null,
  sessions = null,
} = {}) {
  const startMs = now();
  const userTable = users ?? seedUsers(startMs);
  const sessionTable = sessions ?? seedSessions(startMs, ttlMs);

  return {
    createSession(user_id) {
      const token = randomBytes(32).toString('hex');
      const expires_at = isoTime(now() + ttlMs);
      sessionTable.set(token, { user_id, expires_at });
      return { token, expires_at };
    },

    getSession(token) {
      const session = sessionTable.get(token);
      if (session === undefined) return null;
      if (Date.parse(session.expires_at) <= now()) {
        sessionTable.delete(token);
        return null;
      }
      return { user_id: session.user_id, expires_at: session.expires_at };
    },

    destroySession(token) {
      sessionTable.delete(token);
    },

    getUserById(id) {
      return userTable.get(id) ?? null;
    },
  };
}
