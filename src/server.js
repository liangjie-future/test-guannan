import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createLayout } from './layout.js';
import { createRoutes } from './routes.js';
import { TIMELINE_PATH } from './timeline.js';
import { escapeHtml } from './html.js';
import { loadConfig } from './config.js';
import { defaultCurrentUser } from './current-user.js';
import { LOGIN_PATH, RESTRICTED_PATHS, createSessionAccess } from './session-access.js';
import { seedUsers } from './session-store.js';
import { REGISTER_PATH, REGISTER_TITLE, createRegisterPage } from './register-page.js';
import { createMockRegisterService } from './register-service.js';
import { createComposePage } from './compose.js';
import { createMockPostService } from './post-service.js';
import { loginPageContent } from './login-page.js';
import { UNIFIED_LOGIN_ERROR_MESSAGE, MOCK_LOGIN_ACCOUNTS, createMockLoginService } from './login-mock.js';
import { readFormBody } from './form-body.js';
import { createUsersPage, parseFollowActionPath } from './users-page.js';
import { createPythonBridge } from './python-bridge.js';
import {
  createBridgeLoginService,
  createBridgeRegisterService,
  createBridgeStore,
} from './bridge-services.js';
import { createRealSocialService } from './real-social-service.js';

/**
 * FP-004 页面骨架路由 + FP-005 运行载体（配置 / 启动 / 优雅停机）
 * + FP-003 会话管理与访问控制（sessionAccess 注入即生效）
 * + FP-006 注册页（GET/POST /register，registerService 注入，默认 §6 Mock）
 * + FP-012 发帖界面（/compose GET 表单 / POST 提交）
 * + FP-008 登录页与退出入口（POST /login 提交，login 服务注入式）
 * + FP-010 用户列表页（usersPage 注入即生效：GET /users 动态渲染、
 *   POST /users/<id>/follow 关注动作）。
 * + FP-014 时间线页面（getTimeline 注入即生效，/ 已登录默认落点 → /timeline）。)
 *
 * 注入 sessionAccess 时：currentUser 取会话凭据解析、受限三页
 * （/users /compose /timeline）与关注动作挂 requireLogin 守卫、/logout 变为
 * 销毁动作；未注入时保持 FP-004 基线（恒未登录、全路由占位可达）。
 * 未注入 usersPage 时 /users 维持 FP-004 占位内容区。
 * /compose 提交一律要求登录：匿名 POST 无论何种组装均 302 登录页。
 * login 按 §3.2 契约注入（默认 §6 Mock：bob / right-password 两态）。
 * 注入 getTimeline 时：/timeline 渲染该服务返回的帖子流（默认 §6 Mock）。
 */

function notFoundContent(pathname) {
  return `<section>
  <h1>页面未找到</h1>
  <p>路径 <code>${escapeHtml(pathname)}</code> 不存在。</p>
  <p><a href="/">返回首页</a></p>
</section>`;
}

function sendText(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...extraHeaders,
  });
  response.end(body);
}

function sendHtml(response, html, status = 200) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

export function createWebServer({
  getCurrentUser = defaultCurrentUser,
  sessionAccess = null,
  registerService = createMockRegisterService(),
  createPost = null,
  login = createMockLoginService(),
  usersPage = null,
  getTimeline,
  createPostUsesSessionToken = false,
  timelineUsesSessionToken = false,
} = {}) {
  const layout = createLayout({
    getCurrentUser: sessionAccess ? sessionAccess.currentUser : getCurrentUser,
  });
  const registerPage = createRegisterPage({
    registerService,
    createSessionCookie: (result) => {
      if (sessionAccess && result.expires_at) {
        return sessionAccess.sessionCookie({ token: result.session_token, expires_at: result.expires_at });
      }
      const session = sessionAccess?.createSessionOnLogin(result.user.id);
      return sessionAccess
        ? sessionAccess.sessionCookie(session)
        : `session_token=${encodeURIComponent(result.session_token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
    },
  });
  const composePage = createComposePage({
    createPost: createPost ?? createMockPostService().createPost,
    useSessionToken: createPostUsesSessionToken,
  });
  const routes = createRoutes({
    getTimeline,
    timelineUsesSessionToken,
  });

  async function handleCompose(request, response, user) {
    if (request.method === 'POST') {
      if (user === null) {
        response.writeHead(302, { Location: LOGIN_PATH });
        response.end();
        return;
      }

      let contentHtml;
      try {
        contentHtml = await composePage.submit(
          request,
          user,
          sessionAccess?.sessionTokenFromRequest(request) ?? null,
        );
      } catch (error) {
        sendText(response, error.statusCode ?? 500, `${error.message}\n`);
        return;
      }
      sendHtml(response, layout.renderPage(request, contentHtml, { title: '发帖' }));
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'method not allowed\n', { Allow: 'GET, POST' });
      return;
    }

    const html = layout.renderPage(request, composePage.formHtml(), { title: '发帖' });
    sendHtml(response, request.method === 'HEAD' ? undefined : html);
  }

  /** FP-008 登录提交：成功建会话下发 Cookie 并跳转 /timeline；失败 200 回渲染统一提示。 */
  async function handleLoginSubmit(request, response) {
    let form;
    try {
      form = await readFormBody(request);
    } catch (err) {
      sendText(response, err.statusCode ?? 400, 'bad request\n');
      return;
    }

    let result;
    try {
      result = await login(form.get('username') ?? '', form.get('password') ?? '');
    } catch (error) {
      sendText(response, error.statusCode ?? 500, `${error.message}\n`);
      return;
    }
    if (result.status === 'OK') {
      const headers = { Location: '/timeline' };
      if (sessionAccess) {
        const session = result.expires_at
          ? { token: result.session_token, expires_at: result.expires_at }
          : sessionAccess.createSessionOnLogin(result.user.id);
        headers['Set-Cookie'] = sessionAccess.sessionCookie(session);
      }
      response.writeHead(302, headers);
      response.end();
      return;
    }

    const html = layout.renderPage(
      request,
      loginPageContent({ error: result.message ?? UNIFIED_LOGIN_ERROR_MESSAGE }),
      { title: routes['/login'].title },
    );
    sendHtml(response, html);
  }

  /** FP-010 关注动作（仅注入 usersPage 时可达）：登录门槛 + 委托页面处理 + PRG 跳回。 */
  function handleFollowAction(request, response, followeeId) {
    const viewer = sessionAccess
      ? sessionAccess.requireLogin(request, response)
      : getCurrentUser(request);
    if (viewer === null) {
      if (!sessionAccess) {
        response.writeHead(302, { Location: LOGIN_PATH });
        response.end();
      }
      return;
    }
    if (request.method !== 'POST') {
      sendText(response, 405, 'method not allowed\n', { Allow: 'POST' });
      return;
    }
    const token = sessionAccess?.sessionTokenFromRequest(request) ?? null;
    const { status, location } = usersPage.handleFollowAction({ currentUser: viewer, sessionToken: token, followeeId });
    response.writeHead(status, { Location: location });
    response.end();
  }

  async function handleRequest(request, response) {
    let url;
    try {
      url = new URL(request.url, 'http://localhost');
    } catch {
      sendText(response, 400, 'bad request\n');
      return;
    }
    const pathname = url.pathname;

    const followeeId = usersPage === null ? null : parseFollowActionPath(pathname);
    if (followeeId !== null) {
      handleFollowAction(request, response, followeeId);
      return;
    }

    const isRegisterPage = pathname === REGISTER_PATH;
    const isComposePage = pathname === '/compose';
    const route = routes[pathname];
    if (!route && !isRegisterPage && !isComposePage) {
      const html = layout.renderPage(request, notFoundContent(pathname), {
        title: '页面未找到',
      });
      sendHtml(response, html, 404);
      return;
    }

    let user = sessionAccess ? null : getCurrentUser(request);
    if (sessionAccess) {
      if (pathname === '/logout') {
        const token = sessionAccess.sessionTokenFromRequest(request);
        if (token !== null) sessionAccess.logout(token);
        response.writeHead(302, {
          Location: LOGIN_PATH,
          'Set-Cookie': sessionAccess.clearSessionCookie(),
        });
        response.end();
        return;
      }
      if (RESTRICTED_PATHS.includes(pathname)) {
        const guarded = sessionAccess.requireLogin(request, response);
        if (guarded === null) return;
        user = guarded;
      } else {
        user = sessionAccess.currentUser(request);
      }
    } else {
      user = getCurrentUser(request);
    }

    if (isComposePage) {
      handleCompose(request, response, user).catch((error) => {
        if (!response.headersSent) {
          sendText(response, error.statusCode ?? 500, `${error.message}\n`);
        }
      });
      return;
    }

    if (request.method === 'POST' && isRegisterPage) {
      registerPage.handlePost(request, response, { layout }).catch((error) => {
        if (!response.headersSent) sendText(response, error.statusCode ?? 500, `${error.message}\n`);
      });
      return;
    }

    if (pathname === '/login' && request.method === 'POST') {
      await handleLoginSubmit(request, response);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'method not allowed\n', {
        Allow: isRegisterPage || pathname === '/login' ? 'GET, POST' : 'GET',
      });
      return;
    }

    // FP-014 默认落点：时间线即登录后首页——已登录访问 / 直达 /timeline；
    // 未登录保持 FP-004 演示页基线（匿名入口不回归）。
    if (pathname === '/' && user !== null) {
      response.writeHead(302, { Location: TIMELINE_PATH });
      response.end();
      return;
    }

    let content = isRegisterPage
      ? registerPage.renderForm()
      : typeof route.render === 'function'
        ? route.render({
            request,
            user,
            sessionToken: sessionAccess?.sessionTokenFromRequest(request) ?? null,
          })
        : route.content;
    if (usersPage && pathname === '/users') {
      if (user === null) {
        response.writeHead(302, { Location: LOGIN_PATH });
        response.end();
        return;
      }
      content = usersPage.renderContent({
        currentUser: user,
        sessionToken: sessionAccess?.sessionTokenFromRequest(request) ?? null,
        searchParams: url.searchParams,
      });
    }
    const title = isRegisterPage ? REGISTER_TITLE : route.title;
    const html = layout.renderPage(request, content, { title });
    sendHtml(response, request.method === 'HEAD' ? undefined : html);
  }

  return http.createServer((request, response) => {
    handleRequest(request, response).catch((err) => {
      if (response.headersSent) {
        response.destroy(err);
        return;
      }
      sendText(response, err.statusCode ?? 500, `${err.message ?? 'internal server error'}\n`);
    });
  });
}

function formatListenUrl(host, port) {
  const hostPart = host.includes(':') ? `[${host}]` : host;
  return `http://${hostPart}:${port}/`;
}

/**
 * Web 组装用户表：FP-003 种子 alice + FP-008 §6 登录替身（bob，id=2）。
 * 替身记录使 Mock 登录成功后 currentUser → getUserById 可解析（登录态贯通）。
 */
export function webUsers() {
  const users = seedUsers(Date.now());
  const createdAt = new Date().toISOString();
  for (const account of MOCK_LOGIN_ACCOUNTS) {
    users.set(account.id, {
      id: account.id,
      username: account.username,
      password_hash: `hash-${account.username}-placeholder`,
      salt: `salt-${account.username}-placeholder`,
      created_at: createdAt,
    });
  }
  return users;
}

/**
 * FP-005 启动服务：确保 DATA_DIR 存在（FP-001 持久化承载目录）并监听配置地址。
 * FP-003 默认注入 Python bridge store 的会话访问控制；生产启动不写入种子数据。
 * FP-006 默认 Mock 经 createSessionOnLogin 桥接会话存储：注册成功下发的
 * 凭据即被识别，302 时间线直接呈现已登录导航。
 * FP-013 实现产在 Python，生产发帖和时间线均通过真实 social adapter 使用会话 token。
 * FP-010 默认注入 Python bridge 社交 store 的用户列表页。
 * FP-014 默认通过 Python bridge 读取 /timeline 数据；启动时保持数据目录为空。)
 * @returns {Promise<{server: http.Server, url: string, config: object}>}
 */
export async function startServer(config = loadConfig()) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const bridge = config.bridge ?? createPythonBridge({ dataDir: config.dataDir });
  bridge.health();
  const social = createRealSocialService(bridge);
  const socialStore = {
    ...createBridgeStore(bridge),
    currentUser: social.currentUser,
    listUsers: social.listUsers,
    follow: social.follow,
    destroySession: social.logout,
  };
  const sessionAccess = createSessionAccess({ store: socialStore });
  const registerService = createBridgeRegisterService(bridge);
  const usersPage = createUsersPage({
    listUsers: socialStore.listUsers,
    follow: socialStore.follow,
    getFolloweeIds: socialStore.getFolloweeIds,
  });
  const server = createWebServer({
    sessionAccess,
    registerService,
    createPost: social.createPost,
    createPostUsesSessionToken: true,
    login: createBridgeLoginService(bridge),
    usersPage,
    getTimeline: social.getTimeline,
    timelineUsesSessionToken: true,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return {
    server,
    url: formatListenUrl(config.host, server.address().port),
    config,
  };
}

export function registerGracefulShutdown(server) {
  const shutdown = (signal) => {
    console.log(`[server] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 1000).unref();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export async function main() {
  const config = loadConfig();
  const { server, url } = await startServer(config);
  registerGracefulShutdown(server);
  console.log(`[server] service up: ${url} (DATA_DIR=${config.dataDir})`);
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((err) => {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  });
}
