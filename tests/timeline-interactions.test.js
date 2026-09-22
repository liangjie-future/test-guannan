import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createTimelinePage } from '../src/timeline.js';
import {
  createMockGetVisibleInteractions,
  parseCommentFailure,
  commentFailureMessage,
} from '../src/interaction-area.js';
import { createWebServer } from '../src/server.js';
import { escapeHtml } from '../src/html.js';
import { MAX_POST_LENGTH } from '../src/post-service.js';

/**
 * FP-006 时间线内嵌受限互动区（任务卡 §7 验收 1–6 / §8 独立验证方式）。
 * 断言走 HTML 字符串与 data-testid，风格对齐 tests/timeline-page.test.js。
 */

const alice = { id: 1, username: 'alice' };

/** §6 种子帖子流（与 createMockGetTimeline 场景 A 同构的显式子集）。 */
const P1 = { id: 1, author_id: 2, author_username: 'bob', content: '早起的鸟儿有虫吃', created_at: '2026-09-16T08:15:00Z' };
const P2 = { id: 2, author_id: 3, author_username: 'carol', content: '午饭试试新开的那家面馆', created_at: '2026-09-17T18:45:00Z' };
const P3 = { id: 3, author_id: 3, author_username: 'carol', content: '读完了《设计数据密集型应用》第九章', created_at: '2026-09-18T09:30:00Z' };

/** 自定义载荷替身：entries[postId] 缺省回退空载荷；calls 记录调用以断言查询主体。 */
function stubInteractions(entries = {}, calls = null) {
  return (viewerId, posts) => {
    if (calls) calls.push({ viewerId, postIds: posts.map((p) => p.id) });
    return posts.map((post) => entries[post.id] ?? emptyPayload(post.id));
  };
}

function emptyPayload(postId) {
  return {
    post_id: postId,
    likes: [],
    comments: [],
    visible_like_count: 0,
    visible_comment_count: 0,
    viewer_liked: false,
  };
}

function pageWith({ posts, entries = {}, getVisibleInteractions = null, calls = null } = {}) {
  return createTimelinePage({
    getTimeline: () => posts,
    getVisibleInteractions: getVisibleInteractions ?? stubInteractions(entries, calls),
  });
}

/** 切分互动区：从 marker 起到该区评论表单 </form> 止（计数器脚本里的选择器字面量非区域，过滤之）。 */
function interactionAreas(html) {
  return html
    .split('data-testid="interaction-area"')
    .slice(1)
    .filter((chunk) => /^ data-post-id="\d+">/.test(chunk))
    .map((chunk) => {
      const formAt = chunk.indexOf('data-testid="comment-form"');
      const end = chunk.indexOf('</form>', formAt);
      return end === -1 ? chunk : chunk.slice(0, end + '</form>'.length);
    });
}

function areaFor(html, postId) {
  const area = interactionAreas(html).find((chunk) => chunk.startsWith(` data-post-id="${postId}"`));
  assert.ok(area !== undefined, `缺少帖 ${postId} 的互动区`);
  return area;
}

function areaTexts(area, testid) {
  return [...area.matchAll(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`, 'g'))].map((m) => m[1]);
}

async function withServer(options, run) {
  const server = createWebServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('A1: 标准场景——alice 查 P1：carol 点赞 / 评论可见、dave 隐藏、计数仅含可见、评论正序', () => {
  // 默认 Mock 外包一层记录调用主体（查询方式断言）
  const calls = [];
  const defaultMock = createMockGetVisibleInteractions();
  const html = createTimelinePage({
    getTimeline: () => [P1],
    getVisibleInteractions: (viewerId, posts) => {
      calls.push({ viewerId, postIds: posts.map((p) => p.id) });
      return defaultMock(viewerId, posts);
    },
  }).render(alice);
  const area = areaFor(html, 1);

  assert.deepEqual(areaTexts(area, 'visible-like-user'), ['carol'], '可见点赞集合应恰为 carol');
  assert.ok(!area.includes('dave'), 'dave（非共同好友）不应出现在可见集合');
  assert.deepEqual(areaTexts(area, 'comment-author'), ['carol', 'alice'], '可见评论作者（帖主 bob 自互动排除）');
  assert.deepEqual(areaTexts(area, 'comment-content'), ['好帖，顶一个', '写得太好了'], '评论按创建时间正序（早→晚）');
  assert.ok(area.includes('>1 赞<'), '点赞计数仅含可见条目');
  assert.ok(area.includes('>2 评论<'), '评论计数仅含可见条目');

  assert.deepEqual(calls, [{ viewerId: 1, postIds: [1] }], 'getVisibleInteractions 以查看者 id 与帖子数组调用');
});

test('A2: 顺序保持——渲染层按载荷返回顺序原样渲染评论（正序由服务保证）', () => {
  const ordered = [1, 2, 3].map((i) => ({
    id: i,
    user_id: 3,
    username: 'carol',
    content: `第${i}楼`,
    created_at: `2026-02-0${i}T10:00:00Z`,
  }));
  const html = pageWith({
    posts: [P1],
    entries: {
      1: { ...emptyPayload(1), comments: ordered, visible_comment_count: 3 },
    },
  }).render(alice);

  assert.deepEqual(areaTexts(areaFor(html, 1), 'comment-content'), ['第1楼', '第2楼', '第3楼']);
});

test('A3: toggle 两态——viewer_liked=false → not-liked；true → liked（默认 Mock P1/P2）', () => {
  const html = createTimelinePage({
    getTimeline: () => [P1, P2],
    getVisibleInteractions: createMockGetVisibleInteractions(),
  }).render(alice);

  const area1 = areaFor(html, 1);
  const area2 = areaFor(html, 2);
  assert.match(area1, /data-like-state="not-liked"/, 'P1 alice 未赞 → 未赞态');
  assert.match(area2, /data-like-state="liked"/, 'P2 alice 已赞 → 已赞态');
  assert.ok(!area1.includes('data-like-state="liked"'), '未赞帖不得出现已赞态');
  assert.ok(!area2.includes('data-like-state="not-liked"'), '已赞帖不得出现未赞态');
});

test('A4: 空态——0 赞 0 评论，无占位、无「部分已隐藏」类提示，结构保留', () => {
  const html = createTimelinePage({
    getTimeline: () => [P3],
    getVisibleInteractions: createMockGetVisibleInteractions(),
  }).render(alice);
  const area = areaFor(html, 3);

  assert.ok(area.includes('>0 赞<'), '空态点赞计数为 0');
  assert.ok(area.includes('>0 评论<'), '空态评论计数为 0');
  assert.ok(!area.includes('暂无'), '无占位文案');
  assert.ok(!area.includes('隐藏'), '无「部分已隐藏」类泄露提示');
  assert.equal(areaTexts(area, 'visible-like-user').length, 0, '点赞集合无条目');
  assert.equal(areaTexts(area, 'comment-item').length, 0, '评论列表无条目');
  for (const testid of ['like-form', 'visible-likes', 'visible-like-count', 'visible-comment-count', 'comment-list', 'comment-form', 'comment-input']) {
    assert.ok(area.includes(`data-testid="${testid}"`), `空态结构保留：${testid}`);
  }
});

test('A5: 非好友帖主与好友帖子走同一呈现路径——同载荷下互动区归一化后逐字节同构', () => {
  const payload = {
    post_id: 0,
    likes: [{ user_id: 3, username: 'carol', created_at: '2026-02-01T10:00:00Z' }],
    comments: [{ id: 1, user_id: 3, username: 'carol', content: '同一路径', created_at: '2026-02-01T11:00:00Z' }],
    visible_like_count: 1,
    visible_comment_count: 1,
    viewer_liked: true,
  };
  const friendPost = P1; // bob：alice 好友
  const nonFriendPost = { id: 9, author_id: 9, author_username: 'erin', content: '非好友帖主的帖子', created_at: '2026-09-19T00:00:00Z' };
  const html = pageWith({
    posts: [friendPost, nonFriendPost],
    entries: { 1: { ...payload, post_id: 1 }, 9: { ...payload, post_id: 9 } },
  }).render(alice);

  const normalize = (area) =>
    area.replace(/^ data-post-id="\d+">/, ' data-post-id="X">').replace(/\/posts\/\d+\//g, '/posts/X/');
  const areas = interactionAreas(html);
  assert.equal(areas.length, 2);
  assert.equal(normalize(areas[0]), normalize(areas[1]), '好友与非好友帖主互动区产物结构应同构');
});

test('A6: HTTP 层失败回显 TOO_LONG——281 字原文回显 P1 输入框、失败文案与计数联动', async () => {
  const tooLong = '好'.repeat(MAX_POST_LENGTH + 1);
  await withServer(
    {
      getCurrentUser: () => alice,
      getTimeline: () => [P1, P2],
      getVisibleInteractions: stubInteractions(),
    },
    async (base) => {
      const url =
        `${base}/timeline?comment_failed_post=1&comment_error=TOO_LONG` +
        `&comment_text=${encodeURIComponent(tooLong)}`;
      const res = await fetch(url, { redirect: 'manual' });
      assert.equal(res.status, 200);
      const html = await res.text();

      assert.equal((html.match(/data-testid="comment-feedback"/g) ?? []).length, 1, '失败文案全页恰一处');
      const area1 = areaFor(html, 1);
      assert.ok(area1.includes('data-reason="TOO_LONG"'));
      assert.ok(
        area1.includes(`评论失败：内容超过 ${MAX_POST_LENGTH} 字上限（当前 ${MAX_POST_LENGTH + 1} 字），评论未发表`),
        '超限失败文案口径（N＝去首尾空白后码点数）',
      );
      assert.ok(area1.includes(`data-testid="comment-input"`), 'P1 输入框存在');
      assert.ok(area1.includes(`>${escapeHtml(tooLong)}<`), '281 字原文完整回显在 P1 输入框');
      assert.ok(area1.includes(`data-count="${MAX_POST_LENGTH + 1}"`), '计数器初始值联动原文码点数');
      assert.ok(area1.includes(`>${MAX_POST_LENGTH + 1} / ${MAX_POST_LENGTH}<`), '计数位文案联动');

      const area2 = areaFor(html, 2);
      assert.ok(!area2.includes('data-testid="comment-feedback"'), '失败不影响其余帖');
      assert.ok(area2.includes('>0 / 280<'), 'P2 计数器保持 0');
    },
  );
});

test('A6b: 失败回显 EMPTY_CONTENT——空内容文案与纯空白原文回显（render 单元路径）', () => {
  const searchParams = new URLSearchParams(
    'comment_failed_post=1&comment_error=EMPTY_CONTENT&comment_text=%20%20%E3%80%82%20%20',
  );
  const html = pageWith({ posts: [P1] }).render(alice, { searchParams });
  const area = areaFor(html, 1);

  assert.ok(area.includes('data-reason="EMPTY_CONTENT"'));
  assert.ok(area.includes('评论失败：内容为空（去首尾空白后无内容），评论未发表'));
  assert.ok(area.includes(`>${escapeHtml('  。  ')}<`), '原输入（去空白前原文）回显输入框');
});

test('A7: 失败只影响目标帖——指向 P2 时 P1 无反馈、输入框为空', () => {
  const searchParams = new URLSearchParams('comment_failed_post=2&comment_error=TOO_LONG&comment_text=%E8%B6%85');
  const html = pageWith({ posts: [P1, P2] }).render(alice, { searchParams });

  const area1 = areaFor(html, 1);
  const area2 = areaFor(html, 2);
  assert.ok(!area1.includes('data-testid="comment-feedback"'), 'P1 不受影响');
  assert.match(area1, /data-testid="comment-input"[^>]*><\/textarea>/, 'P1 输入框为空');
  assert.ok(area2.includes('data-testid="comment-feedback"'), '反馈仅在 P2');
  assert.ok(area2.includes(`>${escapeHtml('超')}<`), '原文回显仅在 P2');
});

test('A8: 全量正序展示、不分页——5 赞 6 评论全部渲染且顺序与载荷一致', () => {
  const likes = [2, 3, 5, 6, 7].map((uid, i) => ({
    user_id: uid,
    username: `user${uid}`,
    created_at: `2026-02-01T10:00:0${i}Z`,
  }));
  const comments = [1, 2, 3, 4, 5, 6].map((i) => ({
    id: i,
    user_id: 3,
    username: 'carol',
    content: `楼层${String(i).padStart(2, '0')}`,
    created_at: `2026-02-01T11:00:0${i - 1}Z`,
  }));
  const html = pageWith({
    posts: [P1],
    entries: {
      1: { post_id: 1, likes, comments, visible_like_count: 5, visible_comment_count: 6, viewer_liked: false },
    },
  }).render(alice);
  const area = areaFor(html, 1);

  assert.deepEqual(areaTexts(area, 'visible-like-user'), likes.map((l) => l.username), '点赞集合全量');
  assert.deepEqual(areaTexts(area, 'comment-content'), comments.map((c) => c.content), '评论全量且正序');
  assert.ok(area.includes('>5 赞<') && area.includes('>6 评论<'));
  assert.ok(!html.includes('下一页') && !html.includes('上一页'), '无分页控件');
});

test('M1: 默认 Mock 载荷形状（§3.2-1）——标准场景 / 两态 / 空态', () => {
  const mock = createMockGetVisibleInteractions();
  const entries = mock(1, [
    { id: 1, author_id: 2 },
    { id: 2, author_id: 3 },
    { id: 3, author_id: 3 },
  ]);

  assert.deepEqual(entries.map((e) => e.post_id), [1, 2, 3]);
  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry).sort(), [
      'comments',
      'likes',
      'post_id',
      'viewer_liked',
      'visible_comment_count',
      'visible_like_count',
    ]);
    for (const like of entry.likes) {
      assert.deepEqual(Object.keys(like).sort(), ['created_at', 'user_id', 'username']);
    }
    for (const comment of entry.comments) {
      assert.deepEqual(Object.keys(comment).sort(), ['content', 'created_at', 'id', 'user_id', 'username']);
    }
  }

  const [p1, p2, p3] = entries;
  assert.deepEqual(p1.likes.map((l) => l.username), ['carol'], 'dave 隐藏、bob 自互动排除');
  assert.deepEqual(p1.comments.map((c) => c.id), [1, 4], '可见评论＝carol + alice（正序）');
  assert.equal(p1.visible_like_count, 1);
  assert.equal(p1.visible_comment_count, 2);
  assert.equal(p1.viewer_liked, false, 'P1 未赞态');

  assert.equal(p2.viewer_liked, true, 'P2 已赞态（toggle 来源）');
  assert.ok(p2.likes.some((l) => l.username === 'alice'), '查看者本人点赞恒可见（D5）');
  assert.equal(p2.visible_comment_count, 1, 'bob（共同好友）评论可见');

  assert.equal(p3.visible_like_count, 0);
  assert.equal(p3.visible_comment_count, 0);
  assert.equal(p3.viewer_liked, false);
});

test('M2: Mock 种子注入替换——显式空数组即空态，不回落默认', () => {
  const mock = createMockGetVisibleInteractions({ likes: [], comments: [] });
  const [entry] = mock(1, [{ id: 1, author_id: 2 }]);
  assert.deepEqual(entry.likes, []);
  assert.deepEqual(entry.comments, []);
  assert.equal(entry.visible_like_count, 0);
  assert.equal(entry.visible_comment_count, 0);
  assert.equal(entry.viewer_liked, false);
});

test('E1: 回显参数解析边界——残缺 / 未知码 / 非数字帖号不渲染反馈', () => {
  assert.equal(parseCommentFailure(null), null);
  assert.equal(parseCommentFailure(new URLSearchParams('')), null);
  assert.equal(parseCommentFailure(new URLSearchParams('comment_failed_post=1')), null);
  assert.equal(parseCommentFailure(new URLSearchParams('comment_error=TOO_LONG')), null);
  assert.equal(parseCommentFailure(new URLSearchParams('comment_failed_post=1&comment_error=WHATEVER')), null);
  assert.equal(parseCommentFailure(new URLSearchParams('comment_failed_post=abc&comment_error=TOO_LONG')), null);
  assert.deepEqual(
    parseCommentFailure(new URLSearchParams('comment_failed_post=7&comment_error=EMPTY_CONTENT')),
    { postId: 7, reason: 'EMPTY_CONTENT', text: '' },
    'comment_text 缺省按空串',
  );

  const html = pageWith({ posts: [P1] }).render(alice, {
    searchParams: new URLSearchParams('comment_failed_post=1&comment_error=WHATEVER&comment_text=x'),
  });
  assert.ok(!html.includes('data-testid="comment-feedback"'), '未知错误码不渲染反馈');
});

test('E2: 无参数基线——全页无失败反馈', () => {
  const html = pageWith({ posts: [P1, P2] }).render(alice);
  assert.ok(!html.includes('data-testid="comment-feedback"'));
});

test('X1: XSS 边界——用户名 / 评论内容 / 回显原文全部经转义', () => {
  const hostileText = '<img src=y onerror="alert(3)">&"\'';
  const html = pageWith({
    posts: [P1],
    entries: {
      1: {
        post_id: 1,
        likes: [{ user_id: 5, username: '<script>alert(1)</script>', created_at: '2026-02-01T10:00:00Z' }],
        comments: [
          { id: 1, user_id: 5, username: '<b>坏人</b>', content: '<img src=x onerror="alert(2)">', created_at: '2026-02-01T11:00:00Z' },
        ],
        visible_like_count: 1,
        visible_comment_count: 1,
        viewer_liked: false,
      },
    },
  }).render(alice, {
    searchParams: new URLSearchParams({
      comment_failed_post: '1',
      comment_error: 'TOO_LONG',
      comment_text: hostileText,
    }),
  });

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<img src=y'));
  assert.ok(html.includes(escapeHtml('<script>alert(1)</script>')));
  assert.ok(html.includes(escapeHtml('<img src=x onerror="alert(2)">')));
  assert.ok(html.includes(`>${escapeHtml(hostileText)}<`), '回显原文经转义后进入输入框');
});

test('C1: 字数提示对齐 compose.js——data-max/data-count、码点口径、脚本单段、不设 maxlength', () => {
  const html = createTimelinePage({
    getTimeline: () => [P1, P2],
    getVisibleInteractions: createMockGetVisibleInteractions(),
  }).render(alice);

  for (const area of interactionAreas(html)) {
    assert.ok(area.includes(`data-testid="char-counter"`) && area.includes(`data-max="${MAX_POST_LENGTH}"`));
    assert.ok(!/<textarea[^>]*maxlength/.test(area), '不设 maxlength（超限可达）');
    assert.ok(area.includes(`name="content"`), '评论输入框 name=content');
  }
  assert.ok(areaFor(html, 1).includes('>0 / 280<'), '初始计数 0 / 280');
  assert.equal((html.match(/<script>/g) ?? []).length, 1, '计数器脚本恰一段（按互动区作用域批量绑定）');
  assert.ok(html.includes('Array.from(input.value).length'), '码点口径与 countCodePoints 一致');
});

test('C2: 动作端点占位（§3.2-4）——like/comment 表单指向 FP-007/FP-008 端点', () => {
  const html = pageWith({ posts: [P1] }).render(alice);
  const area = areaFor(html, 1);

  assert.ok(area.includes('method="post" action="/posts/1/like"'), '点赞表单端点');
  assert.ok(area.includes('method="post" action="/posts/1/comment"'), '评论表单端点');
  assert.ok(area.includes('data-testid="like-form"') && area.includes('data-testid="comment-form"'));
});

test('R1: 失败文案口径（对齐发帖链路）——N＝去首尾空白后码点数', () => {
  assert.equal(commentFailureMessage('EMPTY_CONTENT', '   '), '评论失败：内容为空（去首尾空白后无内容），评论未发表');
  const padded = '  ' + '好'.repeat(MAX_POST_LENGTH) + '！';
  assert.equal(
    commentFailureMessage('TOO_LONG', padded),
    `评论失败：内容超过 ${MAX_POST_LENGTH} 字上限（当前 ${MAX_POST_LENGTH + 1} 字），评论未发表`,
  );
  assert.equal(commentFailureMessage('UNKNOWN', 'x'), null, '未知码无文案');
});
