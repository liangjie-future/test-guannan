import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayout } from '../src/layout.js';

const aliceUser = () => ({ id: 1, username: 'alice' });
const anonymousUser = () => null;

test('L1: renderPage 装配统一布局（页头导航 + 内容区 + 页脚）', () => {
  const { renderPage } = createLayout({ getCurrentUser: anonymousUser });
  const html = renderPage({}, '<p id="marker">内容区标记</p>', { title: '自定义标题' });

  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<header[^>]*class="site-header"/);
  assert.match(html, /<nav[^>]*class="site-nav"/);
  assert.match(html, /<main[^>]*class="site-content"/);
  assert.match(html, /<footer[^>]*class="site-footer"/);
  assert.match(html, /<title>自定义标题/);
  assert.ok(html.includes('内容区标记'));

  const mainAt = html.indexOf('class="site-content"');
  const markerAt = html.indexOf('内容区标记');
  const footerAt = html.indexOf('class="site-footer"');
  assert.ok(mainAt < markerAt && markerAt < footerAt, '内容区应位于 main 内、footer 之前');
});

test('L2: 未登录渲染五入口：注册/登录/用户列表/发帖/时间线', () => {
  const { renderPage } = createLayout({ getCurrentUser: anonymousUser });
  const html = renderPage({}, '<p>演示</p>');

  for (const href of ['/register', '/login', '/users', '/compose', '/timeline']) {
    assert.ok(html.includes(`href="${href}"`), `缺少导航入口 ${href}`);
  }
});

test('L3: 已登录（alice）显示用户名标识、登录态与退出入口', () => {
  const { renderPage } = createLayout({ getCurrentUser: aliceUser });
  const html = renderPage({}, '<p>演示</p>');

  assert.ok(html.includes('data-testid="current-username"'));
  assert.ok(html.includes('alice'));
  assert.ok(html.includes('已登录'));
  assert.ok(html.includes('data-login-state="logged-in"'));
  assert.ok(html.includes('href="/logout"'));
  for (const href of ['/users', '/compose', '/timeline']) {
    assert.ok(html.includes(`href="${href}"`), `缺少主导航入口 ${href}`);
  }
});

test('L4: 未登录显示注册/登录入口，不显示用户名与退出入口', () => {
  const { renderPage } = createLayout({ getCurrentUser: anonymousUser });
  const html = renderPage({}, '<p>演示</p>');

  assert.ok(html.includes('href="/register"'));
  assert.ok(html.includes('href="/login"'));
  assert.ok(html.includes('data-login-state="anonymous"'));
  assert.ok(!html.includes('data-testid="current-username"'));
  assert.ok(!html.includes('class="nav-logout"'));
  assert.ok(!html.includes('href="/logout"'));
  assert.ok(!html.includes('alice'));
});

test('L5: 用户名经 HTML 转义（XSS 边界）', () => {
  const { renderPage } = createLayout({
    getCurrentUser: () => ({ id: 1, username: '<script>alert(1)</script>' }),
  });
  const html = renderPage({}, '<p>演示</p>');

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('L6: 未注入 getCurrentUser 时按未登录渲染（默认注入点）', () => {
  const { renderPage } = createLayout();
  const html = renderPage({}, '<p>演示</p>');

  assert.ok(html.includes('data-login-state="anonymous"'));
  assert.ok(html.includes('href="/register"'));
  assert.ok(!html.includes('href="/logout"'));
});
