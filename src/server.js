import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createLayout } from './layout.js';
import { routes } from './routes.js';
import { escapeHtml } from './html.js';
import { loadConfig } from './config.js';
import { defaultCurrentUser } from './current-user.js';
import { LOGIN_PATH, RESTRICTED_PATHS, createSessionAccess } from './session-access.js';
import { createMemorySessionStore } from './session-store.js';
import { REGISTER_PATH, REGISTER_TITLE, createRegisterPage } from './register-page.js';
import { createMockRegisterService } from './register-service.js';
import { createComposePage } from './compose.js';
import { createMockPostService } from './post-service.js';

/**
 * FP-004 页面骨架路由 + FP-005 运行载体（配置 / 启动 / 优雅停机）
 * + FP-003 会话管理与访问控制（sessionAccess 注入即生效）
 * + FP-006 注册页（GET/POST /register，registerService 注入，默认 §6 Mock）
 * + FP-012 发帖界面（/compose GET 表单 / POST 提交）。
 *
 * 注入 sessionAccess 时：currentUser 取会话凭据解析、受限三页
 * （/users /compose /timeline）挂 requireLogin 守卫、/logout 变为
 * 销毁动作；未注入时保持 FP-004 基线（恒未登录、全路由占位可达）。
 * /compose 提交一律要求登录：匿名 POST 无论何种组装均 302 登录页。
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
} = {}) {
  const layout = createLayout({
    getCurrentUser: sessionAccess ? sessionAccess.currentUser : getCurrentUser,
  });
  const registerPage = createRegisterPage({ registerService });
  const composePage = createComposePage({
    createPost: createPost ?? createMockPostService().createPost,
  });

  function resolveUser(request) {
    return sessionAccess ? sessionAccess.currentUser(request) : getCurrentUser(request);
  }

  async function handleCompose(request, response) {
    if (request.method === 'POST') {
      const user = resolveUser(request);
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

  return http.createServer((request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      sendText(response, 400, 'bad request\n');
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
        const user = sessionAccess.requireLogin(request, response);
        if (user === null) return;
      }
    }

    if (isComposePage) {
      handleCompose(request, response).catch((error) => {
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

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'method not allowed\n', {
        Allow: isRegisterPage ? 'GET, POST' : 'GET',
      });
      return;
    }

    const content = isRegisterPage ? registerPage.renderForm() : route.content;
    const title = isRegisterPage ? REGISTER_TITLE : route.title;
    const html = layout.renderPage(request, content, { title });
    sendHtml(response, request.method === 'HEAD' ? undefined : html);
  });
}

function formatListenUrl(host, port) {
  const hostPart = host.includes(':') ? `[${host}]` : host;
  return `http://${hostPart}:${port}/`;
}

/**
 * FP-005 启动服务：确保 DATA_DIR 存在（FP-001 持久化承载目录）并监听配置地址。
 * FP-003 默认注入内存 store 的会话访问控制（生产组装）。
 * FP-006 默认 Mock 经 createSessionOnLogin 桥接会话存储：注册成功下发的
 * 凭据即被识别，302 时间线直接呈现已登录导航。
 * FP-013 实现产在 Python，跨进程桥接属集成点，createPost 暂注入契约同形的内存 Mock（§6）。
 * @returns {Promise<{server: http.Server, url: string, config: object}>}
 */
export async function startServer(config = loadConfig()) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const sessionAccess = createSessionAccess({ store: createMemorySessionStore() });
  const registerService = createMockRegisterService({
    createSessionOnLogin: (userId) => sessionAccess.createSessionOnLogin(userId).token,
  });
  const postService = createMockPostService();
  const server = createWebServer({
    sessionAccess,
    registerService,
    createPost: postService.createPost,
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
