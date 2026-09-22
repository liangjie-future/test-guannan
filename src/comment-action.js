/**
 * FP-008 评论提交动作（任务卡 §4）：POST /posts/<id>/comment。
 *
 * 校验口径与仓库既有发帖链路对齐（§3.2-2，上游 D7 冻结）：去首尾空白后
 * 非空、按 Unicode 码点计、1–280 含边界；失败不落库，按 §3.2-4 回显参数
 * 协议 302 回 /timeline（失败文案与原输入的页面呈现由 FP-006 渲染）。
 * 不提供回复 / 嵌套 / 编辑 / 删除路径（上游 D7）。
 */

import { readFormBody } from './form-body.js';
import { TIMELINE_PATH } from './timeline.js';
import {
  MAX_POST_LENGTH,
  REASON_EMPTY_CONTENT,
  REASON_TOO_LONG,
  countCodePoints,
} from './post-service.js';

const COMMENT_ACTION_PATTERN = /^\/posts\/(\d+)\/comment$/;

/** `/posts/<id>/comment` → id（数字）；其余路径 → null（落回既有 404）。 */
export function parseCommentActionPath(pathname) {
  const match = COMMENT_ACTION_PATTERN.exec(pathname);
  return match === null ? null : Number(match[1]);
}

/**
 * 内容校验（§3.2-2，与发帖链路同口径）：
 * 空 → EMPTY_CONTENT；> 280 码点 → TOO_LONG；成功附 trim 后落库文本。
 */
export function validateCommentContent(content) {
  if (typeof content !== 'string') {
    throw new TypeError(`content 必须为字符串，收到 ${typeof content}`);
  }

  const text = content.trim();
  if (!text) {
    return { status: 'ERROR', reason: REASON_EMPTY_CONTENT };
  }
  if (countCodePoints(text) > MAX_POST_LENGTH) {
    return { status: 'ERROR', reason: REASON_TOO_LONG };
  }
  return { status: 'OK', text };
}

/**
 * 失败回跳地址（§3.2-4，与 FP-006 共同冻结）：
 * /timeline?comment_failed_post=<postId>&comment_error=<reason>&comment_text=<URL 编码原输入>
 */
export function commentFailureLocation(postId, reason, originalContent) {
  const params = new URLSearchParams();
  params.set('comment_failed_post', String(postId));
  params.set('comment_error', reason);
  params.set('comment_text', originalContent);
  return `${TIMELINE_PATH}?${params.toString()}`;
}

/**
 * 组装评论动作。createComment 为 FP-002 §3.2 契约端口（Node 侧由 FP-005
 * 内存实现提供，跨语言桥接属集成点，替换注入即收口）。
 */
export function createCommentAction({ createComment }) {
  if (typeof createComment !== 'function') {
    throw new Error('createCommentAction: createComment (FP-002 §3.2) is required');
  }

  /**
   * 动作处理（登录守卫由外层承担）：非 POST 405；读表单 → 校验 →
   * 成功 createComment 落库 + PRG 302 /timeline；失败不落库，302 携回显参数。
   */
  async function handleCommentAction(request, response, user, postId) {
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' });
      response.end('method not allowed\n');
      return;
    }

    let form;
    try {
      form = await readFormBody(request);
    } catch (err) {
      response.writeHead(err.statusCode ?? 400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('bad request\n');
      return;
    }

    const content = form.get('content') ?? '';
    const result = validateCommentContent(content);
    if (result.status === 'ERROR') {
      response.writeHead(302, { Location: commentFailureLocation(postId, result.reason, content) });
      response.end();
      return;
    }

    createComment(postId, user.id, result.text);
    response.writeHead(302, { Location: TIMELINE_PATH });
    response.end();
  }

  return { handleCommentAction };
}
