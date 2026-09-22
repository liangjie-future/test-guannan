/**
 * FP-006 时间线内嵌受限互动区（任务卡 §1/§4）。
 *
 * 每帖 timeline-item 下方渲染：点赞表单（toggle 态）、可见点赞集合、仅可见计数
 * （赞 / 评各一）、评论正序列表、评论输入框与实时字数提示、评论失败回显位。
 *
 * 渲染层只消费过滤后载荷（§3.2-1 getVisibleInteractions 契约），不过滤、不排序
 * （可见性与正序由服务保证，上游 D1/D2/D8）；动作端点 /posts/<id>/like 与
 * /posts/<id>/comment 仅作表单 action 占位（FP-007/FP-008 接收）。
 * 空态只给 0 计数：无占位、无「部分已隐藏」类泄露提示。
 */

import { escapeHtml } from './html.js';
import { createMemoryInteractionStore } from './interaction-store.js';
import { MAX_POST_LENGTH, REASON_EMPTY_CONTENT, REASON_TOO_LONG, countCodePoints } from './post-service.js';

/** 展示文本：ISO 的 `T` 换空格、去尾部 `Z`（口径同 timeline.js 帖时间）。 */
function formatInteractionTime(iso) {
  return String(iso).replace('T', ' ').replace(/Z$/, '');
}

/**
 * §3.2-3 失败文案（与 FP-008 冻结协议，口径对齐发帖链路 D7）：
 * 空 → 内容为空；超限 → N＝去首尾空白后按码点计的实际字数。未知码 → null。
 */
export function commentFailureMessage(reason, text) {
  if (reason === REASON_EMPTY_CONTENT) {
    return '评论失败：内容为空（去首尾空白后无内容），评论未发表';
  }
  if (reason === REASON_TOO_LONG) {
    return `评论失败：内容超过 ${MAX_POST_LENGTH} 字上限（当前 ${countCodePoints(String(text).trim())} 字），评论未发表`;
  }
  return null;
}

/**
 * §3.2-3 回显参数解析：comment_failed_post + comment_error ∈ {EMPTY_CONTENT,
 * TOO_LONG}（comment_text 缺省按空串）。残缺 / 未知码 / 非数字帖号 → null。
 */
export function parseCommentFailure(searchParams) {
  if (!searchParams) return null;
  const rawPost = searchParams.get('comment_failed_post');
  const reason = searchParams.get('comment_error');
  if (rawPost === null || (reason !== REASON_EMPTY_CONTENT && reason !== REASON_TOO_LONG)) {
    return null;
  }
  const postId = Number(rawPost);
  if (!Number.isInteger(postId) || postId <= 0) return null;
  return { postId, reason, text: searchParams.get('comment_text') ?? '' };
}

const emptyInteractionPayload = (postId) => ({
  post_id: postId,
  likes: [],
  comments: [],
  visible_like_count: 0,
  visible_comment_count: 0,
  viewer_liked: false,
});

function likeItem(like) {
  const name = like.username ?? `用户#${like.user_id}`;
  return `        <li class="visible-like-user" data-testid="visible-like-user" title="${escapeHtml(like.created_at)}">${escapeHtml(name)}</li>`;
}

function commentItem(comment) {
  const name = comment.username ?? `用户#${comment.user_id}`;
  return `        <li class="comment-item" data-testid="comment-item">
          <span class="comment-author" data-testid="comment-author">${escapeHtml(name)}</span>
          <span class="comment-content" data-testid="comment-content">${escapeHtml(comment.content)}</span>
          <span class="comment-time" data-testid="comment-time" title="${escapeHtml(comment.created_at)}">${escapeHtml(formatInteractionTime(comment.created_at))}</span>
        </li>`;
}

/**
 * 单帖互动区渲染（好友 / 非好友帖主同一呈现路径，无分支差异）。
 * payload 缺失时防御性回退空态；commentFailure（§3.2-3 解析结果）仅作用于本帖。
 */
export function renderInteractionArea(post, payload = null, commentFailure = null) {
  const data = payload ?? emptyInteractionPayload(post.id);
  const postId = escapeHtml(String(post.id));
  const echoText = commentFailure === null ? '' : commentFailure.text;
  const echoCount = countCodePoints(echoText);
  const failureHtml =
    commentFailure === null
      ? ''
      : `\n      <p class="comment-feedback error" data-testid="comment-feedback" data-reason="${escapeHtml(commentFailure.reason)}">${escapeHtml(commentFailureMessage(commentFailure.reason, echoText) ?? '')}</p>`;
  const likeState = data.viewer_liked ? 'liked' : 'not-liked';

  return `      <div class="interaction-area" data-testid="interaction-area" data-post-id="${postId}">
        <form class="like-form" method="post" action="/posts/${postId}/like" data-testid="like-form">
          <button type="submit" class="like-button" data-testid="like-button" data-like-state="${likeState}">${likeState === 'liked' ? '已赞（点击取消）' : '点赞'}</button>
        </form>
        <div class="interaction-counts">
          <span class="count-like" data-testid="visible-like-count">${data.visible_like_count} 赞</span>
          <span class="count-comment" data-testid="visible-comment-count">${data.visible_comment_count} 评论</span>
        </div>
        <div class="interaction-likes" data-testid="visible-likes">
          <ul class="visible-like-list">
${data.likes.map((like) => likeItem(like)).join('\n')}
          </ul>
        </div>
        <div class="interaction-comments" data-testid="comment-list">
          <ul class="comment-list">
${data.comments.map((comment) => commentItem(comment)).join('\n')}
          </ul>
        </div>${failureHtml}
        <form class="comment-form" method="post" action="/posts/${postId}/comment" data-testid="comment-form">
          <textarea class="comment-input" name="content" rows="2" placeholder="友善评论……" data-testid="comment-input">${escapeHtml(echoText)}</textarea>
          <span class="comment-counter" data-testid="char-counter" data-max="${MAX_POST_LENGTH}" data-count="${echoCount}" aria-live="polite">${echoCount} / ${MAX_POST_LENGTH}</span>
          <button type="submit" class="comment-submit" data-testid="comment-submit">评论</button>
        </form>
      </div>`;
}

/** 实时字数提示脚本：按互动区作用域批量绑定（码点口径同 compose.js，不设 maxlength）。 */
export const INTERACTION_COUNTER_SCRIPT = `<script>
(function () {
  var areas = document.querySelectorAll('[data-testid="interaction-area"]');
  Array.prototype.forEach.call(areas, function (area) {
    var input = area.querySelector('[data-testid="comment-input"]');
    var counter = area.querySelector('[data-testid="char-counter"]');
    if (!input || !counter) return;
    var max = Number(counter.getAttribute('data-max')) || ${MAX_POST_LENGTH};
    function update() {
      var count = Array.from(input.value).length;
      counter.textContent = count + ' / ' + max;
      counter.setAttribute('data-count', String(count));
      counter.classList.toggle('is-over', count > max);
    }
    input.addEventListener('input', update);
    update();
  });
})();
</script>`;

/**
 * §6 Mock：getVisibleInteractions(viewerId, posts) → §3.2-1 载荷（逐帖）。
 *
 * 以 FP-005 内存 store（种子与 FP-004/FP-005 同构）为可见性判定内核，在其输出上
 * 补渲染便利字段 username / viewer_liked（= likes 含查看者本人——D5 恒可见），
 * 即 §3.2-1 所述「数据组装方补齐」的默认实现；种子均可注入替换（显式空数组即
 * 空态，不回落默认），联调时以注入替换收口。
 * 标准场景：alice 查 P1（bob 帖）→ carol 点赞 / 评论可见、dave 隐藏、bob 自互动
 * 排除、viewer_liked=false；P2（carol 帖）→ alice 已赞（true 态）；P3/P4 空态。
 */
const MOCK_USERS = [
  { id: 1, username: 'alice', created_at: '2026-01-01T00:00:00.000Z' },
  { id: 2, username: 'bob', created_at: '2026-01-02T00:00:00.000Z' },
  { id: 3, username: 'carol', created_at: '2026-01-03T00:00:00.000Z' },
  { id: 4, username: 'dave', created_at: '2026-01-04T00:00:00.000Z' },
];

/** 互关边同 FP-005：alice↔bob、alice↔carol、bob↔carol、bob↔dave。 */
const MOCK_FOLLOW_EDGES = [
  [1, 2], [2, 1],
  [1, 3], [3, 1],
  [2, 3], [3, 2],
  [2, 4], [4, 2],
];

/** P1（bob）：carol 可见 / dave 隐藏 / bob 自互动排除；P2（carol）：alice 已赞。 */
const MOCK_LIKES = [
  { post_id: 1, user_id: 3, created_at: '2026-02-01T10:00:00.000Z' },
  { post_id: 1, user_id: 4, created_at: '2026-02-01T10:00:01.000Z' },
  { post_id: 1, user_id: 2, created_at: '2026-02-01T10:00:02.000Z' },
  { post_id: 2, user_id: 1, created_at: '2026-02-02T09:00:00.000Z' },
];

/** P1：c1 carol / c2 dave（隐藏）/ c3 bob（排除）/ c4 alice；P2：c5 bob（共同好友）。 */
const MOCK_COMMENTS = [
  { id: 1, post_id: 1, user_id: 3, content: '好帖，顶一个', created_at: '2026-02-01T11:00:00.000Z' },
  { id: 2, post_id: 1, user_id: 4, content: '路过支持', created_at: '2026-02-01T11:00:01.000Z' },
  { id: 3, post_id: 1, user_id: 2, content: '谢谢大家', created_at: '2026-02-01T11:00:02.000Z' },
  { id: 4, post_id: 1, user_id: 1, content: '写得太好了', created_at: '2026-02-01T11:00:03.000Z' },
  { id: 5, post_id: 2, user_id: 2, content: '同感，这家店不错', created_at: '2026-02-02T10:00:00.000Z' },
];

export function createMockGetVisibleInteractions({
  users = null,
  followEdges = null,
  likes = null,
  comments = null,
} = {}) {
  const seeds = {
    users: users ?? MOCK_USERS,
    followEdges: followEdges ?? MOCK_FOLLOW_EDGES,
    likes: likes ?? MOCK_LIKES,
    comments: comments ?? MOCK_COMMENTS,
  };
  const usernames = new Map(seeds.users.map((user) => [user.id, user.username]));
  const store = createMemoryInteractionStore(seeds);
  const usernameOf = (userId) => usernames.get(userId) ?? `用户#${userId}`;

  return (viewerId, posts) =>
    store.getVisibleInteractions(viewerId, posts).map((entry) => ({
      post_id: entry.post_id,
      likes: entry.likes.map((like) => ({
        user_id: like.user_id,
        username: usernameOf(like.user_id),
        created_at: like.created_at,
      })),
      comments: entry.comments.map((comment) => ({
        id: comment.id,
        user_id: comment.user_id,
        username: usernameOf(comment.user_id),
        content: comment.content,
        created_at: comment.created_at,
      })),
      visible_like_count: entry.visible_like_count,
      visible_comment_count: entry.visible_comment_count,
      viewer_liked: entry.likes.some((like) => like.user_id === viewerId),
    }));
}
