/**
 * FP-012 发帖界面：纯文本输入 + 发布控件 + 实时字数提示（当前 / 280），
 * 提交调用 createPost 服务（§3.2 契约）并按三态呈现结果。
 *
 * 本模块只产出内容区字符串，经 FP-004 renderPage(request, 内容区) 挂载进
 * 统一布局；登录门槛由外层（FP-003 requireLogin / 302 兜底）承担。
 */

import { escapeHtml } from './html.js';
import {
  MAX_POST_LENGTH,
  REASON_EMPTY_CONTENT,
  REASON_TOO_LONG,
  countCodePoints,
} from './post-service.js';

/** POST 请求体上限：280 字纯文本远小于此值，超出直接 413（不触达发帖服务）。 */
const MAX_BODY_BYTES = 64 * 1024;

async function readUrlencodedBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function feedbackHtml(reason, content) {
  const attrs =
    'class="compose-feedback error" data-testid="compose-feedback" data-result="ERROR"';
  if (reason === REASON_EMPTY_CONTENT) {
    return `<p ${attrs} data-reason="EMPTY_CONTENT">发布失败：内容为空（去首尾空白后无内容），帖子未发布</p>`;
  }
  if (reason === REASON_TOO_LONG) {
    return `<p ${attrs} data-reason="TOO_LONG">发布失败：内容超过 ${MAX_POST_LENGTH} 字上限（当前 ${countCodePoints(content)} 字），帖子未发布</p>`;
  }
  return `<p ${attrs} data-reason="${escapeHtml(String(reason))}">发布失败：${escapeHtml(String(reason))}，帖子未发布</p>`;
}

/** 实时字数提示脚本：监听 input 更新计数器（码点口径与服务端一致）；不设 maxlength，超限可达。 */
const COUNTER_SCRIPT = `<script>
(function () {
  var input = document.getElementById('compose-content');
  var counter = document.querySelector('[data-testid="char-counter"]');
  var max = Number(counter.getAttribute('data-max')) || ${MAX_POST_LENGTH};
  function update() {
    var count = Array.from(input.value).length;
    counter.textContent = count + ' / ' + max;
    counter.setAttribute('data-count', String(count));
    counter.classList.toggle('is-over', count > max);
  }
  input.addEventListener('input', update);
  update();
})();
</script>`;

function formFragment(content) {
  const count = countCodePoints(content);
  return `<form class="compose-form" method="post" action="/compose" data-testid="compose-form">
  <label class="compose-label" for="compose-content">帖子内容</label>
  <textarea class="compose-input" id="compose-content" name="content" rows="6" placeholder="分享点纯文本……" data-testid="compose-content">${escapeHtml(content)}</textarea>
  <div class="compose-actions">
    <span class="compose-counter" data-testid="char-counter" data-max="${MAX_POST_LENGTH}" data-count="${count}" aria-live="polite">${count} / ${MAX_POST_LENGTH}</span>
    <button class="compose-submit" type="submit" data-testid="publish-button">发布</button>
  </div>
</form>
${COUNTER_SCRIPT}`;
}

function composeSection(inner) {
  return `<section class="compose" data-page="compose">
  <h1>发帖</h1>
  <p class="compose-hint">输入纯文本发布，字数上限 ${MAX_POST_LENGTH}（去首尾空白后按字符计）。</p>
${inner}
</section>`;
}

/**
 * 组装发帖页。createPost 为 FP-013 §3.2 契约端口（未实现时注入
 * src/post-service.js 的 Mock）。返回 { formHtml, submit }。
 */
export function createComposePage({ createPost }) {
  if (typeof createPost !== 'function') {
    throw new Error('createComposePage: createPost (FP-013 §3.2) is required');
  }

  /** GET /compose：表单渲染（可选回显内容与服务端失败原因）。 */
  function formHtml({ content = '', feedback = null } = {}) {
    const parts = [];
    if (feedback !== null) {
      parts.push(`  ${feedbackHtml(feedback, content)}`);
    }
    parts.push(formFragment(content));
    return composeSection(parts.join('\n'));
  }

  /** 发布成功：反馈 + 已发布帖子摘要 + 可继续发帖的空表单。 */
  function successHtml(post) {
    const inner = `  <p class="compose-feedback ok" data-testid="compose-feedback" data-result="OK">发布成功</p>
  <article class="compose-published" data-testid="published-post">
    <p class="compose-published-content">${escapeHtml(post.content)}</p>
    <p class="compose-published-meta">${countCodePoints(post.content)} 字</p>
  </article>
${formFragment('')}`;
    return composeSection(inner);
  }

  /** POST /compose：读表单 → createPost(author_id, content) → 三态结果呈现。 */
  async function submit(request, user) {
    const params = await readUrlencodedBody(request);
    const content = params.get('content') ?? '';

    const result = createPost(user.id, content);
    if (result.status === 'OK') {
      return successHtml(result.post);
    }
    return formHtml({ content, feedback: result.reason });
  }

  return { formHtml, submit };
}
