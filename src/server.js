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

/**
 * FP-004 页面骨架路由 + FP-005 运行载体（配置 / 启动 / 优雅停机）
 * + FP-003 会话管理与访问控制（sessionAccess 注入即生效）。
 *
 * 注入 sessionAccess 时：currentUser 取会话凭据解析、受限三页
 * （/users /compose /timeline）挂 requireLogin 守卫、/logout 变为
 * 销毁动作；未注入时保持 FP-004 基线（恒未登录、全路由占位可达）。
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

export function createWebServer({ getCurrentUser = defaultCurrentUser, sessionAccess = null } = {}) {
  const layout = createLayout({
    getCurrentUser: sessionAccess ? sessionAccess.currentUser : getCurrentUser,
  });

  return http.createServer((request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      sendText(response, 400, 'bad request\n');
      return;
    }

    const route = routes[pathname];
    if (!route) {
      const html = layout.renderPage(request, notFoundContent(pathname), {
        title: '页面未找到',
      });
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
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

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'method not allowed\n', { Allow: 'GET' });
      return;
    }

    const html = layout.renderPage(request, route.content, { title: route.title });
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : html);
  });
}

function formatListenUrl(host, port) {
  const hostPart = host.includes(':') ? `[${host}]` : host;
  return `http://${hostPart}:${port}/`;
}

/**
 * FP-005 启动服务：确保 DATA_DIR 存在（FP-001 持久化承载目录）并监听配置地址。
 * FP-003 默认注入内存 store 的会话访问控制（生产组装）。
 * @returns {Promise<{server: http.Server, url: string, config: object}>}
 */
export async function startServer(config = loadConfig()) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const sessionAccess = createSessionAccess({ store: createMemorySessionStore() });
  const server = createWebServer({ sessionAccess });
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
