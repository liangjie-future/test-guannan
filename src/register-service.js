/**
 * FP-006 §6 可注入 Mock：register 服务替身（任务卡 §3.2 契约三态）。
 *
 *     register(username, password) →
 *       成功 {status: "OK", user: {id, username}, session_token}
 *       失败 {status: "ERROR", reason: "USERNAME_TAKEN" | "PASSWORD_TOO_SHORT"}
 *
 * 有状态内存实现（初始为空），规则顺序对齐 FP-007：用户名占用 → 密码 ≥6 位；
 * 验证用种子即任务卡样例："alice"/"secret123" 首次 OK、再次 USERNAME_TAKEN、
 * "newuser"/"12345" PASSWORD_TOO_SHORT。真实建号由 FP-007 提供，联调时整体替换注入。
 */

export const MIN_PASSWORD_LENGTH = 6;

/**
 * @param {{ createSessionOnLogin?: (userId: number) => string }} [options]
 *   createSessionOnLogin：会话建立桥（FP-003 createSessionOnLogin 派生 token 用），
 *   缺省返回确定性假凭据（仅供页面下发 Cookie，不被会话存储识别）。
 */
export function createMockRegisterService({ createSessionOnLogin } = {}) {
  const users = new Map();
  let nextId = 1;

  return {
    register(username, password) {
      if (users.has(username)) {
        return { status: 'ERROR', reason: 'USERNAME_TAKEN' };
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        return { status: 'ERROR', reason: 'PASSWORD_TOO_SHORT' };
      }
      const user = { id: nextId++, username };
      users.set(username, user);
      const token = createSessionOnLogin
        ? createSessionOnLogin(user.id)
        : `mock-session-${user.id}`;
      return { status: 'OK', user: { id: user.id, username: user.username }, session_token: token };
    },

    /** 测试口径：Mock 是否已收录该用户名（失败态断言「账号未创建」用）。 */
    hasUser(username) {
      return users.has(username);
    },

    userCount() {
      return users.size;
    },
  };
}
