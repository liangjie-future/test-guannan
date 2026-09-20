import { escapeHtml } from './html.js';
import { defaultCurrentUser } from './current-user.js';

const SITE_NAME = 'Twitter 社交平台';

const MAIN_NAV_LINKS = [
  { href: '/timeline', label: '时间线' },
  { href: '/users', label: '用户列表' },
  { href: '/compose', label: '发帖' },
];

const STYLES = `
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2933; background: #f5f7fa; }
a { color: #1d6fb8; }
.site-header { background: #152840; }
.site-nav { display: flex; align-items: center; gap: 1rem; max-width: 960px; margin: 0 auto; padding: 0.75rem 1rem; }
.nav-brand { color: #fff; font-weight: 700; text-decoration: none; margin-right: 0.5rem; }
.nav-links { display: flex; gap: 0.75rem; }
.nav-auth { margin-left: auto; display: flex; align-items: center; gap: 0.75rem; }
.nav-link, .nav-logout { color: #dbe4ee; text-decoration: none; }
.nav-link:hover, .nav-logout:hover { text-decoration: underline; }
.nav-user { color: #dbe4ee; font-size: 0.9rem; }
.nav-login-state { color: #7ee2a8; font-size: 0.85rem; }
.site-content { max-width: 960px; margin: 1.5rem auto; padding: 1rem; background: #fff; border-radius: 8px; }
.site-footer { max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #7b8794; font-size: 0.85rem; }
`;

function isLoggedIn(user) {
  return user !== null && user !== undefined;
}

function renderNav(user) {
  const mainLinks = MAIN_NAV_LINKS.map(
    (link) => `<a class="nav-link" href="${link.href}">${link.label}</a>`,
  ).join('\n      ');

  const authArea = isLoggedIn(user)
    ? `<div class="nav-auth" data-login-state="logged-in">
      <span class="nav-user">当前用户：<strong data-testid="current-username">${escapeHtml(user.username)}</strong></span>
      <span class="nav-login-state">已登录</span>
      <a class="nav-logout" href="/logout">退出</a>
    </div>`
    : `<div class="nav-auth" data-login-state="anonymous">
      <a class="nav-link" href="/register">注册</a>
      <a class="nav-link" href="/login">登录</a>
    </div>`;

  return `<nav class="site-nav" aria-label="主导航">
    <a class="nav-brand" href="/">${SITE_NAME}</a>
    <div class="nav-links">
      ${mainLinks}
    </div>
    ${authArea}
  </nav>`;
}

export function createLayout({ getCurrentUser = defaultCurrentUser } = {}) {
  function renderPage(request, content, { title = SITE_NAME } = {}) {
    const user = getCurrentUser(request);
    const loginState = isLoggedIn(user) ? 'logged-in' : 'anonymous';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body data-login-state="${loginState}">
<header class="site-header">
  ${renderNav(user)}
</header>
<main class="site-content">
${content}
</main>
<footer class="site-footer">
  <p>${SITE_NAME} · Step 1 · FP-004 统一布局骨架</p>
</footer>
</body>
</html>`;
  }

  return { renderPage };
}
