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
import { createMemorySessionStore, seedUsers } from './session-store.js';
import { REGISTER_PATH, REGISTER_TITLE, createRegisterPage } from './register-page.js';
import { createMockRegisterService } from './register-service.js';
import { createComposePage } from './compose.js';
import { createMockPostService } from './post-service.js';
import { loginPageContent } from './login-page.js';
import { UNIFIED_LOGIN_ERROR_MESSAGE, MOCK_LOGIN_ACCOUNTS, createMockLoginService } from './login-mock.js';
import { readFormBody } from './form-body.js';
import { createMemorySocialStore } from './social-store.js';
import { createFollowService } from './follow-service.js';
import { createUsersPage, parseFollowActionPath } from './users-page.js';
import { parseLikeActionPath, createLikeActionService } from './like-action.js';
import { createCommentAction, parseCommentActionPath } from './comment-action.js';
import { createMemoryInteractionStore } from './interaction-store.js';
import { createTimelineInteractionArea } from './timeline-interactions.js';

/**
 * FP-004 页面骨架路由 + FP-005 运行载体（配置 / 启动 / 优雅停机）
 * + FP-003 会话管理与访问控制（sessionAccess 注入即生效）
 * + FP-006 注册页（GET/POST /register，registerService 注入，默认 §6 Mock）
 * + FP-012 发帖界面（/compose GET 表单 / POST 提交）
 * + FP-008 登录页与退出入口（POST /login 提交，login 服务注入式）
 * + FP-010 用户列表页（usersPage 注入即生效：GET /users 动态渲染、
 *   POST /users/<id>/follow 关注动作）。
 * + FP-014 时间线页面（getTimeline 注入即生效，/ 已登录默认落点 → /timeline）。)
 * + FP-007 点赞动作（likeStore 注入即生效：POST /posts/<id>/like
 *   toggle 切换点赞 / 取消，PRG 302 /timeline）。
 * + FP-008 评论提交动作（POST /posts/<id>/comment：createComment 注入即生效，
 *   校验口径同发帖链路，失败按 §3.2-4 回显参数 PRG 回 /timeline）。
 * + FP-009 互动强制过滤与鉴权兜底（interactionVisibility 注入即生效：
 *   /timeline 互动区数据组装固定经可见性服务唯一过滤；两个互动动作路由
 *   以路径模式前置 requireActionLogin——守卫先于方法检查与存储触达）。
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
  likeStore = null,
  getTimeline,
  createComment = null,
  interactionVisibility = null,
} = {}) {
  const layout = createLayout({
    getCurrentUser: sessionAccess ? sessionAccess.currentUser : getCurrentUser,
  });
  const registerPage = createRegisterPage({ registerService });
  const composePage = createComposePage({
    createPost: createPost ?? createMockPostService().createPost,
  });
  const commentAction = createCommentAction({
    createComment: createComment ?? createMemoryInteractionStore().createComment,
  });
  // FP-009 读取强制过滤：互动区片段唯一来源＝注入可见性服务（FP-004 §3.2-1
  // 契约，FP-005 内存 Mock 同形）的 getVisibleInteractions 输出；未注入保持
  // FP-014 纯帖子流基线。
  const interactionArea =
    interactionVisibility === null
      ? null
      : createTimelineInteractionArea({ visibility: interactionVisibility }).renderFragments;
  const routes = createRoutes({ getTimeline, interactionArea });
  const likeAction = likeStore === null ? null : createLikeActionService({ store: likeStore });

  async function handleCompose(request, response, user) {
    if (request.method === 'POST') {
      if (user === null) {
        response.writeHead(302, { Location: LOGIN_PATH });
        response.end();
        return;
      }

      let contentHtml;
      try {
        contentHtml = await composePage.submit(request, user);
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

    const result = login(form.get('username') ?? '', form.get('password') ?? '');
    if (result.status === 'OK') {
      const headers = { Location: '/timeline' };
      if (sessionAccess) {
        const session = sessionAccess.createSessionOnLogin(result.user.id);
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

  /**
   * 动作路由共用登录门槛（FP-009 守卫纳管面：关注 / 点赞 / 评论）：
   * 已登录放行 viewer；未登录 / 会话失效写 302 /login 并返回 null——
   * 调用方据此先于方法检查与存储触达终止，不产生互动记录。
   */
  function requireActionLogin(request, response) {
    const viewer = sessionAccess
      ? sessionAccess.requireLogin(request, response)
      : getCurrentUser(request);
    if (viewer === null && !sessionAccess) {
      response.writeHead(302, { Location: LOGIN_PATH });
      response.end();
    }
    return viewer;
  }

  /** FP-010 关注动作（仅注入 usersPage 时可达）：登录门槛 + 委托页面处理 + PRG 跳回。 */
  function handleFollowAction(request, response, followeeId) {
    const viewer = requireActionLogin(request, response);
    if (viewer === null) return;
    if (request.method !== 'POST') {
      sendText(response, 405, 'method not allowed\n', { Allow: 'POST' });
      return;
    }
    const { status, location } = usersPage.handleFollowAction({ currentUser: viewer, followeeId });
    response.writeHead(status, { Location: location });
    response.end();
  }

  /** FP-007 点赞动作（仅注入 likeStore 时可达）：登录门槛 + toggle 切换 + PRG 跳回时间线。 */
  function handleLikeAction(request, response, postId) {
    const viewer = requireActionLogin(request, response);
    if (viewer === null) return;
    if (request.method !== 'POST') {
      sendText(response, 405, 'method not allowed\n', { Allow: 'POST' });
      return;
    }
    likeAction.toggleLike(postId, viewer.id);
    response.writeHead(302, { Location: TIMELINE_PATH });
    response.end();
  }

  /** FP-008 评论提交动作（登录守卫先行 + 委托处理器：405 / 413 / 校验 / PRG）。 */
  async function handleCommentAction(request, response, postId) {
    const viewer = requireActionLogin(request, response);
    if (viewer === null) return;
    await commentAction.handleCommentAction(request, response, viewer, postId);
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

    const likePostId = likeAction === null ? null : parseLikeActionPath(pathname);
    if (likePostId !== null) {
      handleLikeAction(request, response, likePostId);
      return;
    }

    const commentPostId = parseCommentActionPath(pathname);
    if (commentPostId !== null) {
      await handleCommentAction(request, response, commentPostId);
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
          sendText(response, 500, `${error.message}\n`);
        }
      });
      return;
    }

    if (request.method === 'POST' && isRegisterPage) {
      registerPage.handlePost(request, response, { layout }).catch(() => {
        if (!response.headersSent) sendText(response, 500, 'internal error\n');
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
        ? route.render({ request, user })
        : route.content;
    if (usersPage && pathname === '/users') {
      if (user === null) {
        response.writeHead(302, { Location: LOGIN_PATH });
        response.end();
        return;
      }
      content = usersPage.renderContent({ currentUser: user, searchParams: url.searchParams });
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
      sendText(response, 500, 'internal server error\n');
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
 * FP-003 默认注入内存 store 的会话访问控制（生产组装，FP-008 webUsers() 种子：
 * alice + 登录替身 bob 进入用户表）。
 * FP-006 默认 Mock 经 createSessionOnLogin 桥接会话存储：注册成功下发的
 * 凭据即被识别，302 时间线直接呈现已登录导航。
 * FP-013 实现产在 Python，跨进程桥接属集成点，createPost 暂注入契约同形的内存 Mock（§6）。
 * FP-010 默认注入种子内存社交 store 的用户列表页（§6 Mock 策略）。
 * FP-014 未注入 getTimeline 时 /timeline 使用默认 §6 Mock（场景 A 种子帖子流）。)
 * FP-007 默认注入 FP-005 内存互动 store 的点赞存取（likeStore，§3.2 契约）。
 * FP-009 默认注入同一 store 为可见性服务（interactionVisibility）与评论写入
 * （createComment）：/timeline 互动区经 getVisibleInteractions 服务端过滤。
 * @returns {Promise<{server: http.Server, url: string, config: object}>}
 */
export async function startServer(config = loadConfig()) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const sessionAccess = createSessionAccess({ store: createMemorySessionStore({ users: webUsers() }) });
  const registerService = createMockRegisterService({
    createSessionOnLogin: (userId) => sessionAccess.createSessionOnLogin(userId).token,
  });
  const postService = createMockPostService();
  const socialStore = createMemorySocialStore();
  const followService = createFollowService({ store: socialStore });
  const usersPage = createUsersPage({
    listUsers: socialStore.listUsers,
    follow: followService.follow,
    getFolloweeIds: followService.getFolloweeIds,
  });
  // FP-007 点赞存取：FP-005 内存实现按 §3.2 契约提供（Python 桥接属集成点）。
  // FP-009 收口：点赞 / 评论写入与可见性服务共享同一互动 store——
  // 写入与过滤读取落在同一数据面（此前 comment 动作回落独立默认实例）。
  const interactionStore = createMemoryInteractionStore();
  const server = createWebServer({
    sessionAccess,
    registerService,
    createPost: postService.createPost,
    usersPage,
    likeStore: interactionStore,
    createComment: interactionStore.createComment,
    interactionVisibility: interactionStore,
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
