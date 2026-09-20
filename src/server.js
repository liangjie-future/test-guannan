import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createLayout } from './layout.js';
import { routes } from './routes.js';
import { escapeHtml } from './html.js';
import { loadConfig } from './config.js';

/**
 * FP-004 页面骨架路由 + FP-005 运行载体（配置 / 启动 / 优雅停机）。
 * `'/'` 等页面由 FP-004 统一布局渲染；FP-005 负责监听配置、DATA_DIR
 * 预留（FP-001 持久化目录）与 SIGTERM/SIGINT 优雅停机。
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

export function createWebServer({ getCurrentUser } = {}) {
  const layout = createLayout({ getCurrentUser });

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
 * @returns {Promise<{server: http.Server, url: string, config: object}>}
 */
export async function startServer(config = loadConfig()) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const server = createWebServer();
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
