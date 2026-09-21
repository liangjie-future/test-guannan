import test from 'node:test';
import assert from 'node:assert/strict';

import { createTimelinePage, createMockGetTimeline } from '../src/timeline.js';

const alice = { id: 1, username: 'alice' };

// §6 场景 A 种子：B、C 各 2 帖，发布时间交错，已按时间倒序（t4→t3→t2→t1）
const scenarioA = [
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

function pageWith(posts, calls = null) {
  return createTimelinePage({
    getTimeline: (user_id) => {
      if (calls) calls.push(user_id);
      return posts;
    },
  });
}

function itemContents(html, testid) {
  return [...html.matchAll(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`, 'g'))].map(
    (m) => m[1],
  );
}

function itemTimes(html) {
  return [...html.matchAll(/<time[^>]*datetime="([^"]*)"/g)].map((m) => m[1]);
}

test('T1: 场景 A 渲染 4 条帖子，每条含作者 / 内容 / 时间', () => {
  const page = pageWith(scenarioA);
  const html = page.render(alice);

  assert.ok(html.includes('<h1>时间线</h1>'));
  const items = html.match(/data-testid="timeline-item"/g) ?? [];
  assert.equal(items.length, 4, '条目数应与 Mock 一致（4）');

  assert.deepEqual(itemContents(html, 'post-author'), [
    'bob',
    'carol',
    'carol',
    'bob',
  ]);
  assert.deepEqual(itemContents(html, 'post-content'), scenarioA.map((p) => p.content));
  assert.deepEqual(itemTimes(html), scenarioA.map((p) => p.created_at), '<time datetime> 应为原始 ISO');
});

test('T2: 范围与倒序——作者恰为 B/C，顺序与服务返回一致（t4→t3→t2→t1）', () => {
  const html = pageWith(scenarioA).render(alice);

  const authors = itemContents(html, 'post-author');
  assert.deepEqual([...new Set(authors)].sort(), ['bob', 'carol'], '作者集合应为 {bob, carol}');
  assert.ok(!authors.includes('alice'), '不应出现自己的帖子');
  assert.deepEqual(
    itemTimes(html),
    [...scenarioA].map((p) => p.created_at),
    '页面顺序应与服务返回顺序逐条一致（已倒序）',
  );
});

test('T3: 页面不重排——替身故意升序返回，仍按返回顺序渲染', () => {
  const ascending = [...scenarioA].reverse();
  const html = pageWith(ascending).render(alice);

  assert.deepEqual(itemTimes(html), ascending.map((p) => p.created_at));
});

test('T4: 空集合显示空态提示并引导去用户列表', () => {
  const html = pageWith([]).render(alice);

  assert.ok(html.includes('还没有关注任何人'));
  assert.ok(html.includes('href="/users"'));
  assert.ok(html.includes('data-testid="timeline-empty"'));
  assert.equal((html.match(/data-testid="timeline-item"/g) ?? []).length, 0);
});

test('T5: 帖子内容与作者名经 HTML 转义（XSS 边界）', () => {
  const hostile = [
    {
      id: 9,
      author_id: 2,
      author_username: '<script>alert(1)</script>',
      content: '<img src=x onerror="alert(2)"> " \' &',
      created_at: '2026-09-19T00:00:00Z',
    },
  ];
  const html = pageWith(hostile).render(alice);

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;'));
});

test('T6: author_username 缺失时回退 用户#<author_id>，不崩溃', () => {
  const html = pageWith([
    { id: 5, author_id: 7, author_username: null, content: '匿名残帖', created_at: '2026-09-19T00:00:00Z' },
  ]).render(alice);

  assert.ok(html.includes('用户#7'));
  assert.ok(html.includes('匿名残帖'));
});

test('T7: Mock 契约——场景 A/B 形状与副本隔离', () => {
  const mockA = createMockGetTimeline();
  const first = mockA(1);
  assert.equal(first.length, 4, '场景 A 应返回 4 条（B×2 + C×2）');
  const byAuthor = {};
  for (const post of first) byAuthor[post.author_username] = (byAuthor[post.author_username] ?? 0) + 1;
  assert.deepEqual(byAuthor, { bob: 2, carol: 2 });
  for (let i = 1; i < first.length; i += 1) {
    assert.ok(Date.parse(first[i - 1].created_at) >= Date.parse(first[i].created_at), '应按时间倒序');
  }
  for (const post of first) {
    assert.deepEqual(Object.keys(post).sort(), [
      'author_id',
      'author_username',
      'content',
      'created_at',
      'id',
    ]);
  }

  first.shift();
  first[0].content = '篡改';
  assert.equal(mockA(1).length, 4, '返回副本：调用方修改不污染种子');
  assert.equal(mockA(1)[0].content, '刚跑完五公里，状态不错');

  assert.deepEqual(createMockGetTimeline({ scenario: 'B' })(1), [], '场景 B 返回空集合');
});

test('T8: render 以当前用户 id 作为查询主体', () => {
  const calls = [];
  pageWith(scenarioA, calls).render({ id: 42, username: 'someone' });
  assert.deepEqual(calls, [42]);
});
