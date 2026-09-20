import http from 'node:http';
import { createLayout } from './layout.js';
import { routes } from './routes.js';
import { escapeHtml } from './html.js';

function notFoundContent(pathname) {
  return `<section>
  <h1>页面未找到</h1>
  <p>路径 <code>${escapeHtml(pathname)}</code> 不存在。</p>
  <p><a href="/">返回首页</a></p>
</section>`;
}

export function createWebServer({ getCurrentUser } = {}) {
  const layout = createLayout({ getCurrentUser });

  return http.createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    const route = routes[pathname];
    const status = route ? 200 : 404;

    const html = layout.renderPage(
      request,
      route ? route.content : notFoundContent(pathname),
      { title: route ? route.title : '页面未找到' },
    );

    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
}
