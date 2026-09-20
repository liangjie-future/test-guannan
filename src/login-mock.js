/**
 * FP-008 §6 可注入 login Mock（任务卡 §3.2 契约的 Node 侧替身）。
 *
 * FP-009 的 LoginService 产在 Python，Node Web 进程无法进程内调用；
 * 按契约形状提供两态 Mock 供注入：命中种子账号（bob / right-password）
 * 返回 OK，任意错误组合返回统一失败（文案与 FP-009 LOGIN_ERROR_MESSAGE
 * 一致，不区分用户名 / 密码哪项错）。真实桥接属集成点，替换注入即可。
 */

export const UNIFIED_LOGIN_ERROR_MESSAGE = '用户名或密码错误';

/** §6 验证用种子账号：替身当前用户 bob。 */
export const MOCK_LOGIN_ACCOUNTS = [{ id: 2, username: 'bob', password: 'right-password' }];

function unifiedError() {
  return { status: 'ERROR', message: UNIFIED_LOGIN_ERROR_MESSAGE };
}

/**
 * 构造 Mock 登录服务：login(username, password) →
 * 成功 {status: "OK", user: {id, username}, session_token}；
 * 失败 {status: "ERROR", message: 统一提示}。
 * createSessionOnLogin 可选注入（成功时恰调一次；token / {token} 均归一取 token，
 * 未注入时返回占位 token 仅保契约形状——Web 组装点的会话建立走 FP-003 能力）。
 */
export function createMockLoginService({
  accounts = MOCK_LOGIN_ACCOUNTS,
  createSessionOnLogin = null,
} = {}) {
  return function login(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') {
      return unifiedError();
    }
    const account = accounts.find(
      (candidate) => candidate.username === username && candidate.password === password,
    );
    if (account === undefined) {
      return unifiedError();
    }
    const session = createSessionOnLogin === null ? null : createSessionOnLogin(account.id);
    const session_token =
      session === null
        ? `mock-login-session-${account.id}`
        : (session.token ?? session);
    return {
      status: 'OK',
      user: { id: account.id, username: account.username },
      session_token,
    };
  };
}
