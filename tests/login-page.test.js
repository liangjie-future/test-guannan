import test from 'node:test';
import assert from 'node:assert/strict';

import { loginPageContent } from '../src/login-page.js';

test('P1: 默认内容区含 POST /login 表单、两输入与提交控件，无错误块', () => {
  const html = loginPageContent();

  assert.match(html, /<form[^>]*method="post"/);
  assert.match(html, /<form[^>]*action="\/login"/);
  assert.match(html, /<input[^>]*type="text"[^>]*name="username"/);
  assert.match(html, /<input[^>]*type="password"[^>]*name="password"/);
  assert.match(html, /<button[^>]*type="submit"/);
  assert.ok(!html.includes('login-error'), '默认态不应有错误提示块');
});

test('P2: 失败态保留表单并展示统一错误提示', () => {
  const html = loginPageContent({ error: '用户名或密码错误' });

  assert.match(html, /<form[^>]*method="post"/, '失败后表单应保留可重试');
  assert.match(html, /data-testid="login-error"/);
  assert.ok(html.includes('用户名或密码错误'));
});

test('P3: 错误文案经 HTML 转义（XSS 边界）', () => {
  const html = loginPageContent({ error: '<script>alert(1)</script>' });

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});
