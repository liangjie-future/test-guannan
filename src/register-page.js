/**
 * FP-006 注册页：表单渲染 + 提交处理（内容区挂载进 FP-004 统一布局）。
 *
 * 提交流：收集用户名 / 密码 → 调用 §3.2 契约 register 服务 →
 *   OK    → Set-Cookie 会话凭据 + 302 跳转 /timeline（注册成功即进入登录态）
 *   ERROR → 200 重渲染表单 + 原因文案（用户名已存在 / 密码过短），无成功暗示
 * 页面侧仅做输入完备性守卫（缺失不触达服务）；规则判定与建号属 FP-007。
 */

import { escapeHtml } from './html.js';
import { SESSION_COOKIE_NAME } from './session-access.js';

export const REGISTER_PATH = '/register';
export const REGISTER_TITLE = '注册';
export const REGISTER_SUCCESS_REDIRECT = '/timeline';

/** 会话 Cookie 属性对齐 FP-003（HttpOnly / SameSite=Lax / TTL 7 天）。 */
const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

const MAX_BODY_BYTES = 64 * 1024;

/** 原因文案映射（不内嵌规则细节，阈值等口径由 FP-007 承担）。 */
const REASON_MESSAGES = {
  USERNAME_TAKEN: '用户名已存在',
  PASSWORD_TOO_SHORT: '密码过短',
};
const GENERIC_ERROR_MESSAGE = '注册失败，请稍后重试';
const MISSING_FIELDS_MESSAGE = '请填写用户名和密码';

export function renderRegisterForm({ error = null, username = '' } = {}) {
  const errorBanner = error
    ? `  <div class="form-error" data-testid="register-error" role="alert">${escapeHtml(error)}</div>\n`
    : '';
  return `<section class="register-page">
  <h1>注册</h1>
  <p class="page-intro">填写用户名与密码提交注册，通过后即进入登录态。</p>
${errorBanner}  <form method="post" action="${REGISTER_PATH}" class="register-form" data-testid="register-form">
    <div class="form-field">
      <label for="register-username">用户名</label>
      <input id="register-username" name="username" type="text" data-testid="register-username"
             value="${escapeHtml(username)}" autocomplete="username" required>
    </div>
    <div class="form-field">
      <label for="register-password">密码</label>
      <input id="register-password" name="password" type="password" data-testid="register-password"
             autocomplete="new-password" required>
    </div>
    <button type="submit" class="form-submit" data-testid="register-submit">注册</button>
  </form>
  <p class="form-hint">已有账号？<a href="/login">去登录</a></p>
</section>`;
}

function sessionCookie(token, maxAge = SESSION_COOKIE_MAX_AGE) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * @param {{ registerService: { register: Function } }} options
 * @returns {{ renderForm(options?): string, handlePost(request, response, { layout }) }}
 */
export function createRegisterPage({ registerService, createSessionCookie = sessionCookie }) {
  if (!registerService || typeof registerService.register !== 'function') {
    throw new Error('createRegisterPage: registerService.register is required');
  }

  function respondForm(response, layout, request, { error, username }) {
    const html = layout.renderPage(request, renderRegisterForm({ error, username }), {
      title: REGISTER_TITLE,
    });
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  }

  async function handlePost(request, response, { layout }) {
    let body;
    try {
      body = await readBody(request);
    } catch (err) {
      const tooLarge = err.message === 'payload too large';
      response.writeHead(tooLarge ? 413 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(tooLarge ? 'payload too large\n' : 'bad request\n');
      return;
    }

    const params = new URLSearchParams(body);
    const username = (params.get('username') ?? '').trim();
    const password = params.get('password') ?? '';
    if (username === '' || password === '') {
      respondForm(response, layout, request, { error: MISSING_FIELDS_MESSAGE, username });
      return;
    }

    let result;
    try {
      result = await registerService.register(username, password);
    } catch (err) {
      response.writeHead(err.statusCode ?? 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(`${err.message ?? 'internal error'}\n`);
      return;
    }

    if (
      result !== null &&
      typeof result === 'object' &&
      result.status === 'OK' &&
      typeof result.session_token === 'string' &&
      result.session_token !== ''
    ) {
      response.writeHead(302, {
        Location: REGISTER_SUCCESS_REDIRECT,
        'Set-Cookie': createSessionCookie(result),
      });
      response.end();
      return;
    }

    const reason = result?.status === 'ERROR' ? result.reason : undefined;
    const message = REASON_MESSAGES[reason] ?? GENERIC_ERROR_MESSAGE;
    respondForm(response, layout, request, { error: message, username });
  }

  return { renderForm: renderRegisterForm, handlePost };
}
