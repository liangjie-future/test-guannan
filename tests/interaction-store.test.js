import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryInteractionStore } from '../src/interaction-store.js';

const ALICE = 1;
const BOB = 2;
const CAROL = 3;
const DAVE = 4;

/** §6 标准场景：帖 P1（bob）——查询时传入（store 不持有帖子）。 */
const P1 = { id: 1, author_id: BOB };

const CAROL_LIKE_AT = '2026-02-01T10:00:00.000Z';
const DAVE_LIKE_AT = '2026-02-01T10:00:01.000Z';
const BOB_LIKE_AT = '2026-02-01T10:00:02.000Z';
const T1 = '2026-02-01T11:00:00.000Z';
const T2 = '2026-02-01T11:00:01.000Z';
const T3 = '2026-02-01T11:00:02.000Z';
const T4 = '2026-02-01T11:00:03.000Z';

function emptySeedStore() {
  return createMemoryInteractionStore({
    users: [],
    followEdges: [],
    likes: [],
    comments: [],
  });
}

test('TC-01 A1: 默认种子 getVisibleInteractions(alice, [P1]) 契约同形且过滤语义正确', () => {
  const store = createMemoryInteractionStore();
  const result = store.getVisibleInteractions(ALICE, [P1]);
  assert.equal(result.length, 1);
  const [entry] = result;
  assert.deepEqual(entry, {
    post_id: 1,
    likes: [{ user_id: CAROL, created_at: CAROL_LIKE_AT }],
    comments: [
      { id: 1, user_id: CAROL, content: '好帖，顶一个', created_at: T1 },
      { id: 4, user_id: ALICE, content: '写得太好了', created_at: T4 },
    ],
    visible_like_count: 1,
    visible_comment_count: 2,
  });
  // carol 的点赞与评论在；dave（单方好友）与 bob（帖主自互动）不在
  assert.ok(entry.likes.some((like) => like.user_id === CAROL));
  assert.ok(entry.comments.some((comment) => comment.user_id === CAROL));
  assert.ok(entry.likes.every((like) => like.user_id !== DAVE));
  assert.ok(entry.comments.every((comment) => comment.user_id !== DAVE));
  assert.ok(entry.likes.every((like) => like.user_id !== BOB));
  assert.ok(entry.comments.every((comment) => comment.user_id !== BOB));
  // 计数仅含可见条目
  assert.equal(entry.visible_like_count, entry.likes.length);
  assert.equal(entry.visible_comment_count, entry.comments.length);
});

test('TC-02 帖主视角见全部；未知查看者可见集仅自身 → 空态', () => {
  const store = createMemoryInteractionStore();
  const bobView = store.getVisibleInteractions(BOB, [P1])[0];
  assert.equal(bobView.visible_like_count, 3);
  assert.equal(bobView.visible_comment_count, 4);
  assert.deepEqual(bobView.comments.map((comment) => comment.id), [1, 2, 3, 4]);

  const strangerView = store.getVisibleInteractions(999, [P1])[0];
  assert.deepEqual(strangerView, {
    post_id: 1,
    likes: [],
    comments: [],
    visible_like_count: 0,
    visible_comment_count: 0,
  });
});

test('TC-03 friendIds / mutualFriendIds：双向互关、交集、升序', () => {
  const store = createMemoryInteractionStore();
  assert.deepEqual(store.friendIds(ALICE), [BOB, CAROL]);
  assert.deepEqual(store.friendIds(BOB), [ALICE, CAROL, DAVE]);
  assert.deepEqual(store.friendIds(CAROL), [ALICE, BOB]);
  assert.deepEqual(store.friendIds(DAVE), [BOB]);
  assert.deepEqual(store.friendIds(999), []);
  assert.deepEqual(store.mutualFriendIds(ALICE, BOB), [CAROL]);
  assert.deepEqual(store.mutualFriendIds(ALICE, CAROL), [BOB]);
  assert.deepEqual(store.mutualFriendIds(ALICE, DAVE), [BOB], 'alice 与 dave 的共同好友是 bob');
  assert.deepEqual(store.mutualFriendIds(BOB, BOB), [ALICE, CAROL, DAVE]);
});

test('TC-04 likePost / unlikePost 幂等，读写即时反映', () => {
  const store = createMemoryInteractionStore();
  store.likePost(1, ALICE);
  store.likePost(1, ALICE);
  let likes = store.getLikesByPostIds([1]);
  assert.equal(likes.length, 4);
  assert.deepEqual(
    likes.map((like) => like.user_id).sort((a, b) => a - b),
    [ALICE, BOB, CAROL, DAVE],
  );

  store.unlikePost(1, CAROL);
  store.unlikePost(1, CAROL);
  likes = store.getLikesByPostIds([1]);
  assert.deepEqual(likes.map((like) => like.user_id).sort((a, b) => a - b), [ALICE, BOB, DAVE]);

  const aliceView = store.getVisibleInteractions(ALICE, [P1])[0];
  assert.equal(aliceView.visible_like_count, 1, 'carol 取消后 alice 视角仅剩自己的赞');
});

test('TC-05 createComment：id 自增、完整形状、内容不在本层校验、created_at 取注入时钟', () => {
  const FIXED_AT = '2026-03-01T00:00:00.000Z';
  const store = createMemoryInteractionStore({ now: () => FIXED_AT });
  const blank = store.createComment(1, BOB, '   ');
  assert.deepEqual(blank, { id: 5, post_id: 1, user_id: BOB, content: '   ', created_at: FIXED_AT });
  const long = store.createComment(1, ALICE, '长'.repeat(281));
  assert.equal(long.id, 6);
  assert.equal(long.content.length, 281);
  assert.deepEqual(
    store.getCommentsByPostIds([1]).map((comment) => comment.id),
    [1, 2, 3, 4, 5, 6],
  );
});

test('TC-06 排序：评论时间升序并列按 id；点赞时间升序并列按 (post_id, user_id)', () => {
  const TA = '2026-04-01T00:00:00.000Z';
  const TB = '2026-04-01T00:00:01.000Z';
  const store = createMemoryInteractionStore({
    users: [],
    followEdges: [],
    likes: [
      { post_id: 5, user_id: 9, created_at: TB },
      { post_id: 5, user_id: 8, created_at: TA },
      { post_id: 6, user_id: 7, created_at: TA },
    ],
    comments: [
      { id: 3, post_id: 5, user_id: 9, content: 'c3', created_at: TB },
      { id: 1, post_id: 5, user_id: 8, content: 'c1', created_at: TA },
      { id: 2, post_id: 5, user_id: 9, content: 'c2', created_at: TA },
    ],
  });

  assert.deepEqual(
    store.getCommentsByPostIds([5]).map((comment) => comment.id),
    [1, 2, 3],
    'created_at 升序，同时刻按 id 升序',
  );
  assert.deepEqual(
    store.getLikesByPostIds([5, 6]).map((like) => [like.post_id, like.user_id]),
    [
      [5, 8],
      [6, 7],
      [5, 9],
    ],
    '跨帖全局按 created_at 升序，同时刻按 (post_id, user_id)',
  );
  assert.deepEqual(store.getCommentsByPostIds([999]), []);
  assert.deepEqual(store.getLikesByPostIds([999]), []);
});

test('TC-07 A3: 空种子 → 空互动集与 0 计数，写入原语仍可用', () => {
  const store = emptySeedStore();
  assert.deepEqual(store.getLikesByPostIds([1]), []);
  assert.deepEqual(store.getCommentsByPostIds([1]), []);
  assert.deepEqual(store.friendIds(ALICE), []);
  assert.deepEqual(store.mutualFriendIds(ALICE, BOB), []);
  assert.deepEqual(store.getVisibleInteractions(ALICE, [P1]), [
    { post_id: 1, likes: [], comments: [], visible_like_count: 0, visible_comment_count: 0 },
  ]);

  const comment = store.createComment(1, BOB, '第一条');
  assert.deepEqual(comment, {
    id: 1,
    post_id: 1,
    user_id: BOB,
    content: '第一条',
    created_at: comment.created_at,
  });
  assert.deepEqual(store.getCommentsByPostIds([1]).map((c) => c.id), [1]);
});

test('TC-08 A9: 自定义注入种子完全替换默认种子', () => {
  const store = createMemoryInteractionStore({
    users: [
      { id: 11, username: 'eve', created_at: '2026-05-01T00:00:00.000Z' },
      { id: 12, username: 'frank', created_at: '2026-05-02T00:00:00.000Z' },
      { id: 13, username: 'grace', created_at: '2026-05-03T00:00:00.000Z' },
    ],
    followEdges: [
      [11, 12],
      [12, 11],
      [11, 13],
      [13, 11],
      [12, 13],
      [13, 12],
    ],
    likes: [{ post_id: 9, user_id: 13, created_at: '2026-05-04T00:00:00.000Z' }],
    comments: [
      { id: 1, post_id: 9, user_id: 12, content: 'frank 的评论', created_at: '2026-05-04T00:00:01.000Z' },
    ],
  });

  assert.deepEqual(store.friendIds(11), [12, 13]);
  assert.deepEqual(store.mutualFriendIds(11, 12), [13]);
  assert.equal(store.friendIds(ALICE).length, 0, '默认场景用户不残留');
  assert.deepEqual(store.getLikesByPostIds([1]), [], '默认场景点赞不残留');

  // eve 查看 frank 的帖：可见集 = 共同好友(11,12)={13} ∪ {11}
  const view = store.getVisibleInteractions(11, [{ id: 9, author_id: 12 }])[0];
  assert.deepEqual(view, {
    post_id: 9,
    likes: [{ user_id: 13, created_at: '2026-05-04T00:00:00.000Z' }],
    comments: [],
    visible_like_count: 1,
    visible_comment_count: 0,
  });
});

test('TC-09 副本防御：篡改返回值与种子数组不影响后续查询', () => {
  const seedLikes = [{ post_id: 1, user_id: CAROL, created_at: CAROL_LIKE_AT }];
  const store = createMemoryInteractionStore({
    users: [],
    followEdges: [],
    likes: seedLikes,
    comments: [],
  });

  const likes = store.getLikesByPostIds([1]);
  likes[0].user_id = 999;
  likes.push({ post_id: 1, user_id: 888, created_at: CAROL_LIKE_AT });
  assert.deepEqual(store.getLikesByPostIds([1]), [
    { post_id: 1, user_id: CAROL, created_at: CAROL_LIKE_AT },
  ]);

  const view = store.getVisibleInteractions(ALICE, [P1])[0];
  view.likes.push({ user_id: 777, created_at: CAROL_LIKE_AT });
  view.visible_like_count = 99;
  assert.equal(store.getVisibleInteractions(ALICE, [P1])[0].visible_like_count, 0);

  const friends = store.friendIds(ALICE);
  friends.push(999);
  assert.deepEqual(store.friendIds(ALICE), []);

  seedLikes[0].user_id = 666;
  assert.equal(store.getLikesByPostIds([1])[0].user_id, CAROL, '构造后改种子数组不影响内部状态');
});

test('TC-10 多帖查询按输入顺序逐帖返回；空帖列表 → 空数组', () => {
  const store = createMemoryInteractionStore();
  const P2 = { id: 2, author_id: CAROL };
  const result = store.getVisibleInteractions(ALICE, [P1, P2]);
  assert.deepEqual(
    result.map((entry) => entry.post_id),
    [1, 2],
  );
  assert.deepEqual(result[1], {
    post_id: 2,
    likes: [],
    comments: [],
    visible_like_count: 0,
    visible_comment_count: 0,
  });
  assert.deepEqual(store.getVisibleInteractions(ALICE, []), []);
});

/**
 * TC-11 A2 消费方用例：仅依赖 §3.2 契约的八个方法（签名 / 返回形状），
 * 先后注入本 Mock 与测试内第二实现，行为必须一致（替换注入零改动切换）。
 */
function interactionSnapshot(store, viewerId, posts) {
  const postIds = posts.map((post) => post.id);
  return {
    likes: store.getLikesByPostIds(postIds),
    comments: store.getCommentsByPostIds(postIds),
    friends: store.friendIds(viewerId),
    mutual: store.mutualFriendIds(viewerId, posts[0].author_id),
    visible: store.getVisibleInteractions(viewerId, posts),
  };
}

function exerciseInteractionStore(store) {
  store.likePost(9, 11);
  store.likePost(9, 11);
  store.likePost(9, 12);
  store.unlikePost(9, 12);
  store.unlikePost(9, 42);
  store.createComment(9, 11, '赞一个');
  store.createComment(9, 13, '同感');
  return interactionSnapshot(store, 11, [{ id: 9, author_id: 12 }]);
}

/** 测试内第二实现：数组 + 线性扫描（内部结构不同，契约形状相同）。 */
function createArrayBackedInteractionStore(seed, now) {
  const edges = seed.followEdges.map(([follower, followee]) => [follower, followee]);
  const likes = seed.likes.map((like) => ({ ...like }));
  const comments = seed.comments.map((comment) => ({ ...comment }));
  const hasEdge = (follower, followee) =>
    edges.some(([from, to]) => from === follower && to === followee);
  const friendIds = (userId) =>
    [...new Set(edges.filter(([from]) => from === userId).map(([, to]) => to))]
      .filter((to) => hasEdge(to, userId))
      .sort((a, b) => a - b);

  return {
    likePost(postId, userId) {
      if (!likes.some((like) => like.post_id === postId && like.user_id === userId)) {
        likes.push({ post_id: postId, user_id: userId, created_at: now() });
      }
    },
    unlikePost(postId, userId) {
      const index = likes.findIndex((like) => like.post_id === postId && like.user_id === userId);
      if (index !== -1) likes.splice(index, 1);
    },
    getLikesByPostIds(postIds) {
      return likes
        .filter((like) => postIds.includes(like.post_id))
        .sort(
          (a, b) =>
            Date.parse(a.created_at) - Date.parse(b.created_at) ||
            a.post_id - b.post_id ||
            a.user_id - b.user_id,
        )
        .map((like) => ({ ...like }));
    },
    createComment(postId, userId, content) {
      const id = comments.reduce((max, comment) => Math.max(max, comment.id), 0) + 1;
      const comment = { id, post_id: postId, user_id: userId, content, created_at: now() };
      comments.push(comment);
      return { ...comment };
    },
    getCommentsByPostIds(postIds) {
      return comments
        .filter((comment) => postIds.includes(comment.post_id))
        .sort(
          (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id,
        )
        .map((comment) => ({ ...comment }));
    },
    friendIds,
    mutualFriendIds(v, a) {
      const friendsOfA = new Set(friendIds(a));
      return friendIds(v).filter((id) => friendsOfA.has(id));
    },
    getVisibleInteractions(viewerId, posts) {
      return posts.map((post) => {
        const mutual = friendIds(viewerId).filter((id) =>
          friendIds(post.author_id).includes(id),
        );
        const visible = new Set(mutual);
        visible.add(viewerId);
        const visibleLikes = likes
          .filter((like) => like.post_id === post.id && visible.has(like.user_id))
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.user_id - b.user_id)
          .map(({ user_id, created_at }) => ({ user_id, created_at }));
        const visibleComments = comments
          .filter((comment) => comment.post_id === post.id && visible.has(comment.user_id))
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)
          .map(({ id, user_id, content, created_at }) => ({ id, user_id, content, created_at }));
        return {
          post_id: post.id,
          likes: visibleLikes,
          comments: visibleComments,
          visible_like_count: visibleLikes.length,
          visible_comment_count: visibleComments.length,
        };
      });
    },
  };
}

test('TC-11 A2: 注入本 Mock 与契约同形第二实现，消费方两次行为一致、零改动', () => {
  const seed = {
    users: [{ id: 11, username: 'eve', created_at: '2026-05-01T00:00:00.000Z' }],
    followEdges: [
      [11, 12],
      [12, 11],
      [11, 13],
      [13, 11],
      [12, 13],
      [13, 12],
    ],
    likes: [{ post_id: 9, user_id: 13, created_at: '2026-05-04T00:00:00.000Z' }],
    comments: [],
  };
  const FIXED_AT = '2026-05-05T00:00:00.000Z';

  const viaMock = exerciseInteractionStore(
    createMemoryInteractionStore({ ...seed, now: () => FIXED_AT }),
  );
  const viaSecond = exerciseInteractionStore(
    createArrayBackedInteractionStore(seed, () => FIXED_AT),
  );

  assert.deepEqual(viaMock, viaSecond);
  assert.equal(viaMock.visible[0].visible_like_count, 2, 'grace(13) 种子赞 + eve(11) 新赞可见');
  assert.equal(viaMock.visible[0].visible_comment_count, 2, 'eve 自身评论 + 共同好友 grace 的评论可见');
});
