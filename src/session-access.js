/**
 * FP-003 会话管理与访问控制（任务卡 §3.2 本任务提供的能力）。
 *
 * 会话状态机：
 *   未登录 --登录成功（createSessionOnLogin 建会话 + Cookie 下发）--> 已登录
 *   已登录 --logout（销毁会话）--> 未登录
 *   已登录 --会话过期（expires_at 越过当前时刻）--> 未登录
 *   未登录访问受限页 → requireLogin 写 302 跳转登录页（不 403、不放行）
 */

export const SESSION_COOKIE_NAME = 'session_token';
export const LOGIN_PATH = '/login';

/** 受限页清单（任务卡 §3.2）：用户列表 / 发帖 / 时间线。 */
export const RESTRICTED_PATHS = ['/users', '/compose', '/timeline'];

export function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) jar[name] = value;
  }
  return jar;
}

function secondsUntil(expiresAt) {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
}

/**
 * 组装 FP-003 能力集，store 须满足 FP-001 §3.2 会话存取契约。
 * 返回：createSessionOnLogin / currentUser / requireLogin / logout /
 * sessionCookie / clearSessionCookie / sessionTokenFromRequest。
 */
export function createSessionAccess({
  store,
  cookieName = SESSION_COOKIE_NAME,
  loginPath = LOGIN_PATH,
} = {}) {
  if (!store) {
    throw new Error('createSessionAccess: store is required');
  }

  function sessionTokenFromRequest(request) {
    return parseCookies(request?.headers?.cookie)[cookieName] ?? null;
  }

  /** 凭请求携带的会话凭据解析当前用户；任何一环失效即 null（视为未登录）。 */
  function currentUser(request) {
    const token = sessionTokenFromRequest(request);
    if (token === null) return null;
    const session = store.getSession(token);
    if (session === null) return null;
    const user = store.getUserById(session.user_id);
    if (user === null) return null;
    return { id: user.id, username: user.username };
  }

  return {
    /** 承接「登录成功事件」：建立会话，返回凭据 {token, expires_at}（下发用 sessionCookie）。 */
    createSessionOnLogin(user_id) {
      return store.createSession(user_id);
    },

    currentUser,

    /**
     * 可挂到任意路由的访问控制守卫：已登录返回 {id, username} 放行；
     * 未登录写 302 跳转登录页并返回 null（调用方据此终止处理）。
     */
    requireLogin(request, response) {
      const user = currentUser(request);
      if (user !== null) return user;
      response.writeHead(302, { Location: loginPath });
      response.end();
      return null;
    },

    /** 销毁会话；后续携带原凭据的请求一律视为未登录。幂等。 */
    logout(token) {
      store.destroySession(token);
    },

    sessionTokenFromRequest,

    /** 登录成功后的 Set-Cookie 值（Max-Age 与服务端 expires_at 对齐）。 */
    sessionCookie({ token, expires_at }) {
      const attrs = [
        `Path=/`,
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${secondsUntil(expires_at)}`,
      ];
      return `${cookieName}=${token}; ${attrs.join('; ')}`;
    },

    /** 清除浏览器侧凭据（配合 logout）。 */
    clearSessionCookie() {
      return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    },
  };
}
