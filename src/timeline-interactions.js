/**
 * FP-009 互动服务端强制过滤——读取路径的数据组装层（任务卡 §4）。
 *
 * 服务端数据组装层唯一过滤点：互动明细只来自注入可见性服务的
 * getVisibleInteractions 输出（FP-004 §3.2-1 冻结契约；Node 侧由
 * FP-005 内存 Mock 同形提供），本模块不 import / 不调用任何互动明细
 * 存取原语——「任何代码路径不得绕过过滤直取互动明细」由构造保证。
 *
 * 组装职责（§3.2-1）：在可见性输出上补齐渲染便利字段——
 *   username     经 getUserById 目录（可选端口，缺失回落 用户#<id>）
 *   viewer_liked like.user_id === viewer.id（供 FP-006 已赞态呈现）
 *
 * 渲染红线（D8）：仅可见数口径——列表只含可见条目（沿用服务正序）、
 * 计数＝可见数、无计数差、无占位、无时序空洞；可见集为空 → 0 计数 +
 * 空列表。终态样式细节归 FP-006，此处只提供 data-testid / data-count
 * 钩子的最小呈现。
 */

import { escapeHtml } from './html.js';

/**
 * 组装互动区。visibility 须满足 FP-004 §3.2-1 契约
 * （getVisibleInteractions(viewer_id, posts)）；getUserById 为可选
 * username 目录端口（缺省回落 visibility.getUserById，再缺省回落编号名）。
 */
export function createTimelineInteractionArea({ visibility, getUserById = null } = {}) {
  if (visibility === null || typeof visibility.getVisibleInteractions !== 'function') {
    throw new Error('createTimelineInteractionArea: visibility (FP-004 §3.2 getVisibleInteractions) is required');
  }
  const lookupUser = getUserById ?? ((id) => visibility.getUserById?.(id) ?? null);

  function usernameOf(userId) {
    const user = lookupUser(userId);
    return user === null || user === undefined ? `用户#${userId}` : user.username;
  }

  /**
   * 唯一数据源组装：可见性服务输出 → 补齐 username / viewer_liked。
   * 返回与 posts 对齐的逐帖条目（服务端兜底：匿名 viewer 无互动数据）。
   */
  function assemble(viewer, posts) {
    if (viewer === null || viewer === undefined) return [];
    const entries = visibility.getVisibleInteractions(viewer.id, posts ?? []) ?? [];
    return entries.map((entry) => ({
      post_id: entry.post_id,
      likes: (entry.likes ?? []).map((like) => ({
        user_id: like.user_id,
        username: usernameOf(like.user_id),
        viewer_liked: like.user_id === viewer.id,
        created_at: like.created_at,
      })),
      comments: (entry.comments ?? []).map((comment) => ({
        id: comment.id,
        user_id: comment.user_id,
        username: usernameOf(comment.user_id),
        content: comment.content,
        created_at: comment.created_at,
      })),
      visible_like_count: entry.visible_like_count ?? (entry.likes ?? []).length,
      visible_comment_count: entry.visible_comment_count ?? (entry.comments ?? []).length,
    }));
  }

  function renderEntry(entry) {
    const likeItems = entry.likes
      .map((like) => {
        const viewerAttr = like.viewer_liked ? ' data-viewer-liked="true"' : '';
        const suffix = like.viewer_liked ? '（你）' : '';
        return `      <li data-testid="visible-like" data-user-id="${like.user_id}"${viewerAttr}>${escapeHtml(like.username)}${suffix}</li>`;
      })
      .join('\n');
    const commentItems = entry.comments
      .map(
        (comment) =>
          `      <li data-testid="visible-comment" data-comment-id="${comment.id}" data-user-id="${comment.user_id}"><span class="comment-author">${escapeHtml(comment.username)}</span>：${escapeHtml(comment.content)}</li>`,
      )
      .join('\n');
    return `    <div class="post-interactions" data-testid="post-interactions" data-post-id="${entry.post_id}">
      <p class="interaction-count" data-testid="visible-like-count" data-count="${entry.visible_like_count}">${entry.visible_like_count} 人点赞</p>
      <ul class="like-list" data-testid="visible-like-list">
${likeItems}
      </ul>
      <p class="interaction-count" data-testid="visible-comment-count" data-count="${entry.visible_comment_count}">${entry.visible_comment_count} 条评论</p>
      <ol class="comment-list" data-testid="visible-comment-list">
${commentItems}
      </ol>
    </div>`;
  }

  /** 逐帖 HTML 片段（Map<post_id, html>），供时间线内嵌（FP-006 渲染联动）。 */
  function renderFragments(viewer, posts) {
    const fragments = new Map();
    for (const entry of assemble(viewer, posts)) {
      fragments.set(entry.post_id, renderEntry(entry));
    }
    return fragments;
  }

  return { assemble, renderFragments };
}
