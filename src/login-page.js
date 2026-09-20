import { escapeHtml } from './html.js';

/**
 * FP-008 登录页内容区（挂载进 FP-004 统一布局）。
 *
 * 页面只收集输入：POST /login 的用户名 / 密码表单；error 非空时插入
 * 统一错误提示块（文案来自登录服务返回的 message，不区分哪项错）。
 * 失败态保留表单可重试，不回填输入。
 */
export function loginPageContent({ error = null } = {}) {
  const errorBlock =
    error === null
      ? ''
      : `  <p class="form-error" data-testid="login-error">${escapeHtml(error)}</p>\n`;

  return `<section>
  <h1>登录</h1>
${errorBlock}  <form method="post" action="/login" class="login-form" data-testid="login-form">
    <div class="form-field">
      <label for="login-username">用户名</label>
      <input type="text" id="login-username" name="username" autocomplete="username" required>
    </div>
    <div class="form-field">
      <label for="login-password">密码</label>
      <input type="password" id="login-password" name="password" autocomplete="current-password" required>
    </div>
    <button type="submit" data-testid="login-submit">登录</button>
  </form>
  <p>还没有账号？<a href="/register">先注册</a></p>
</section>`;
}
