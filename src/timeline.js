import { escapeHtml } from './html.js';

/**
 * FP-014 时间线页面（任务卡 §1/§4）：
 * 聚合呈现全部被关注对象的帖子（作者 / 内容 / 发布时间），空态提示引导关注。
 *
 * 依赖注入（§3.2 / §6）：
 *   getTimeline(user_id) → [post]（FP-015；未桥接前用 createMockGetTimeline 占位）
 *   登录门槛由 FP-003 requireLogin 在路由层承担（/timeline ∈ RESTRICTED_PATHS）。
 * 顺序责任分离：页面按服务返回顺序原样渲染，不排序、不过滤（倒序由 FP-015 保证）。
 */

export const TIMELINE_PATH = '/timeline';
const USERS_PATH = '/users';

const PAGE_STYLES = `
.timeline-list { list-style: none; margin: 0; padding: 0; }
.timeline-item { padding: 0.75rem 0; border-bottom: 1px solid #e4e9f0; }
.timeline-item:last-child { border-bottom: none; }
.post-meta { display: flex; align-items: baseline; gap: 0.75rem; }
.post-author { font-weight: 700; }
.post-time { color: #7b8794; font-size: 0.85rem; }
.post-content { margin: 0.35rem 0 0; white-space: pre-wrap; word-break: break-word; }
.timeline-empty, .timeline-anonymous { padding: 1.5rem 0; color: #52606d; }
`;

/** §6 场景 A 种子帖子流：B、C 各 2 帖，发布时间交错，已按时间倒序（t4→t1）。 */
const SEED_POSTS = [
  {
    id: 4,
    author_id: 2,
    author_username: 'bob',
    content: '刚跑完五公里，状态不错',
    created_at: '2026-09-19T10:00:00Z',
  },
  {
    id: 3,
    author_id: 3,
    author_username: 'carol',
    content: '读完了《设计数据密集型应用》第九章',
    created_at: '2026-09-18T09:30:00Z',
  },
  {
    id: 2,
    author_id: 3,
    author_username: 'carol',
    content: '午饭试试新开的那家面馆',
    created_at: '2026-09-17T18:45:00Z',
  },
  {
    id: 1,
    author_id: 2,
    author_username: 'bob',
    content: '早起的鸟儿有虫吃',
    created_at: '2026-09-16T08:15:00Z',
  },
];

/**
 * §6 可注入 Mock：场景 A 返回种子帖子流（B、C 各 2 帖，倒序）；
 * 场景 B 返回空集合（空态验证）。每次调用返回副本，互不污染。
 */
export function createMockGetTimeline({ scenario = 'A' } = {}) {
  return () =>
    scenario === 'B' ? [] : SEED_POSTS.map((post) => ({ ...post }));
}

/** 展示文本：ISO 的 `T` 换空格、去尾部 `Z`；`<time datetime>` 保留原始 ISO。 */
function formatPostTime(iso) {
  return String(iso).replace('T', ' ').replace(/Z$/, '');
}

function renderPost(post) {
  const author = post.author_username ?? `用户#${post.author_id}`;
  const rawTime = String(post.created_at);
  return `  <li class="timeline-item" data-testid="timeline-item">
    <div class="post-meta">
      <span class="post-author" data-testid="post-author">${escapeHtml(author)}</span>
      <time class="post-time" datetime="${escapeHtml(rawTime)}">${escapeHtml(formatPostTime(rawTime))}</time>
    </div>
    <p class="post-content" data-testid="post-content">${escapeHtml(post.content)}</p>
  </li>`;
}

function wrapContent(bodyHtml) {
  return `<section class="timeline-page">
  <h1>时间线</h1>
  <style>${PAGE_STYLES}</style>
${bodyHtml}
</section>`;
}

/** 帖子流条目渲染：沿用服务返回顺序（页面不重排），空集合 → 空态提示。 */
export function renderTimelinePosts(posts) {
  if (!posts || posts.length === 0) {
    return wrapContent(`  <div class="timeline-empty" data-testid="timeline-empty">
    <p>还没有关注任何人，时间线暂时是空的。</p>
    <p><a href="${USERS_PATH}">去用户列表看看，关注一些人</a></p>
  </div>`);
  }
  return wrapContent(`  <ol class="timeline-list">
${posts.map((post) => renderPost(post)).join('\n')}
  </ol>`);
}

/**
 * 时间线页面工厂：getTimeline 构造注入（默认 §6 Mock 场景 A）。
 * render(user) 以登录用户为查询主体；renderAnonymous() 供 FP-004 基线模式
 * （未注入 sessionAccess、无守卫）匿名直访时渲染登录引导而非空态。
 */
export function createTimelinePage({ getTimeline = createMockGetTimeline() } = {}) {
  return {
    render(user) {
      return renderTimelinePosts(getTimeline(user.id));
    },
    renderAnonymous() {
      return wrapContent(`  <div class="timeline-anonymous">
    <p>登录后即可在这里看到你关注对象的帖子。</p>
    <p><a href="/login">去登录</a> ｜ <a href="/register">注册新账号</a></p>
  </div>`);
    },
  };
}
