import { escapeHtml } from './html.js';

/**
 * FP-010 全站用户列表页本体（任务卡 §4）。
 *
 * 依赖按 §3.2 契约注入（未实现时以 §6 Mock / 种子替代）：
 *   listUsers() → [{id, username, created_at}]（全量，含自己）
 *   follow(followerId, followeeId) → 结果对象（三态，见 follow-service.js）
 *   getFolloweeIds(userId) → [userId]（已关注态渲染来源）
 *
 * 自己行：区分标识 + 不提供可用关注操作（关注规则由 follow 依赖承担，
 * 页面对直连自关注请求仅反馈拒绝结果）。
 */

const FOLLOW_ACTION_PATTERN = /^\/users\/(\d+)\/follow$/;

const NOTICE_TEXT = {
  FOLLOW_OK: (searchParams) =>
    `已关注 ${searchParams.get('username') ?? ''}（单向关注，无需对方确认）`,
  SELF_FOLLOW_NOT_ALLOWED: () => '不可关注自己',
  FOLLOWEE_NOT_FOUND: () => '用户不存在',
  FOLLOW_ERROR: () => '关注失败，请重试',
};

/** `/users/<id>/follow` → id；其余路径 → null。 */
export function parseFollowActionPath(pathname) {
  const match = FOLLOW_ACTION_PATTERN.exec(pathname);
  return match === null ? null : Number(match[1]);
}

function renderNotice(searchParams) {
  if (!searchParams) return '';
  const code = searchParams.get('notice');
  const toText = Object.hasOwn(NOTICE_TEXT, code) ? NOTICE_TEXT[code] : null;
  if (!toText) return '';
  return `\n  <p class="page-notice" data-notice="${escapeHtml(code)}">${escapeHtml(toText(searchParams))}</p>`;
}

function renderRow(user, { isSelf, isFollowing }) {
  const selfMarker = isSelf ? ' <span class="self-badge" data-testid="self-marker">（我）</span>' : '';
  const action = isSelf
    ? '<span class="self-no-follow" title="不能关注自己">—</span>'
    : `<form method="post" action="/users/${user.id}/follow" class="follow-form">
        <button type="submit" class="follow-button" data-follow-state="${isFollowing ? 'following' : 'not-following'}">${isFollowing ? '已关注' : '关注'}</button>
      </form>`;
  return `<tr class="user-row" data-user-id="${escapeHtml(user.id)}"${isSelf ? ' data-self="true"' : ''}>
    <td class="user-name">${escapeHtml(user.username)}${selfMarker}</td>
    <td class="user-created">${escapeHtml(user.created_at ?? '')}</td>
    <td class="user-follow-action">${action}</td>
  </tr>`;
}

export function createUsersPage({ listUsers, follow, getFolloweeIds }) {
  if (!listUsers || !follow || !getFolloweeIds) {
    throw new Error('createUsersPage: listUsers, follow and getFolloweeIds are required');
  }

  return {
    /** 渲染内容区（挂载进 FP-004 统一布局；currentUser 为 FP-003 解析出的登录用户）。 */
    renderContent({ currentUser, searchParams = null }) {
      const users = listUsers();
      const followeeIds = new Set(getFolloweeIds(currentUser.id));
      const rows = users
        .map((user) =>
          renderRow(user, {
            isSelf: user.id === currentUser.id,
            isFollowing: followeeIds.has(user.id),
          }),
        )
        .join('\n');
      const emptyHint = users.length === 0 ? '\n  <p class="users-empty">暂无用户。</p>' : '';

      return `<section class="users-page">
  <h1>用户列表</h1>
  <p class="users-intro">全站用户（含你自己）。点击「关注」即建立单向关注，无需对方确认。</p>${emptyHint}${renderNotice(searchParams)}
  <table class="users-table">
    <thead>
      <tr><th scope="col">用户名</th><th scope="col">注册时间</th><th scope="col">关注</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</section>`;
    },

    /** 关注动作：调用注入的 follow，返回 303 重定向目标（PRG，结果经 notice 反馈）。 */
    handleFollowAction({ currentUser, followeeId }) {
      const result = follow(currentUser.id, followeeId);
      if (result.status === 'OK') {
        const target = listUsers().find((user) => user.id === followeeId);
        const username = target === undefined ? '' : target.username;
        return {
          status: 303,
          location: `/users?notice=FOLLOW_OK&username=${encodeURIComponent(username)}`,
        };
      }
      const notice =
        result.reason === 'SELF_FOLLOW_NOT_ALLOWED' || result.reason === 'FOLLOWEE_NOT_FOUND'
          ? result.reason
          : 'FOLLOW_ERROR';
      return { status: 303, location: `/users?notice=${notice}` };
    },
  };
}
