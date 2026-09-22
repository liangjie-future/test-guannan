/**
 * FP-005 互动与可见性服务 Node 侧 Mock（任务卡 §3.2 冻结契约的内存实现）。
 *
 * FP-004 互动可见性判定服务的实现产在 Python（SQLite 层），Node Web 进程
 * 无法进程内调用；此处按同一契约形状提供内存默认实现 + 可注入种子
 * （§6 Mock 策略，与 src/social-store.js、src/session-store.js、
 * src/post-service.js 同模式）。联调替换注入即可，Web 逻辑零改动。
 *
 * 领域口径（任务卡 §2，唯一依据）：
 *   好友 X        = 与 X 双向互关的人
 *   可见集(V, A)  = (好友(V) ∩ 好友(A)) ∪ {V}
 * 互动者 ∈ 可见集则对 V 可见：查看者自身恒可见（D5）；帖主 A 不在集合内，
 * 自互动自然排除；仅可见计数、无泄露提示（D8）；空可见集 → 空列表与 0 计数。
 */

/** §6 标准场景种子：用户 alice=1 / bob=2 / carol=3 / dave=4。 */
const SEED_USERS = [
  { id: 1, username: 'alice', created_at: '2026-01-01T00:00:00.000Z' },
  { id: 2, username: 'bob', created_at: '2026-01-02T00:00:00.000Z' },
  { id: 3, username: 'carol', created_at: '2026-01-03T00:00:00.000Z' },
  { id: 4, username: 'dave', created_at: '2026-01-04T00:00:00.000Z' },
];

/** 互关边 alice↔bob、alice↔carol、bob↔carol、bob↔dave（双向各一条）。 */
const SEED_FOLLOW_EDGES = [
  [1, 2],
  [2, 1],
  [1, 3],
  [3, 1],
  [2, 3],
  [3, 2],
  [2, 4],
  [4, 2],
];

/** 帖 P1（bob）上的点赞：carol / dave / bob。 */
const SEED_LIKES = [
  { post_id: 1, user_id: 3, created_at: '2026-02-01T10:00:00.000Z' },
  { post_id: 1, user_id: 4, created_at: '2026-02-01T10:00:01.000Z' },
  { post_id: 1, user_id: 2, created_at: '2026-02-01T10:00:02.000Z' },
];

/** 帖 P1 上的评论：c1 carol(t1) / c2 dave(t2) / c3 bob(t3) / c4 alice(t4)。 */
const SEED_COMMENTS = [
  { id: 1, post_id: 1, user_id: 3, content: '好帖，顶一个', created_at: '2026-02-01T11:00:00.000Z' },
  { id: 2, post_id: 1, user_id: 4, content: '路过支持', created_at: '2026-02-01T11:00:01.000Z' },
  { id: 3, post_id: 1, user_id: 2, content: '谢谢大家', created_at: '2026-02-01T11:00:02.000Z' },
  { id: 4, post_id: 1, user_id: 1, content: '写得太好了', created_at: '2026-02-01T11:00:03.000Z' },
];

const byInstant = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at);
const byPostAndUser = (a, b) => a.post_id - b.post_id || a.user_id - b.user_id;
const byId = (a, b) => a.id - b.id;

const likeKey = (postId, userId) => `${postId}|${userId}`;

function toEdgeTable(edges) {
  return edges.reduce((table, [follower, followee]) => {
    const followees = table.get(follower) ?? new Set();
    followees.add(followee);
    table.set(follower, followees);
    return table;
  }, new Map());
}

/**
 * 内存版互动与可见性服务（契约同任务卡 §3.2，与 FP-004 Python 侧形状一致）：
 * likePost / unlikePost / getLikesByPostIds / createComment /
 * getCommentsByPostIds / friendIds / mutualFriendIds / getVisibleInteractions。
 *
 * 种子入参（数组，均可注入替换；显式空数组即空态，不回落默认）：
 *   users        [{id, username, created_at}]
 *   followEdges  [[followerId, followeeId], ...]
 *   likes        [{post_id, user_id, created_at}]
 *   comments     [{id, post_id, user_id, content, created_at}]
 * now 可注入（假时钟确定性验证，口径同 session-store / post-service）。
 * posts 不入种子：帖子归属 FP-015，查询时以 [{id, author_id}, ...] 传入。
 * 内部 Map / Set 存储，返回值一律为浅副本（防外部篡改内部状态）。
 */
export function createMemoryInteractionStore({
  users = null,
  followEdges = null,
  likes = null,
  comments = null,
  now = () => new Date().toISOString(),
} = {}) {
  const userTable = new Map((users ?? SEED_USERS).map((user) => [user.id, { ...user }]));
  const edgeTable = toEdgeTable(followEdges ?? SEED_FOLLOW_EDGES);
  const likeTable = new Map(
    (likes ?? SEED_LIKES).map((like) => [likeKey(like.post_id, like.user_id), { ...like }]),
  );
  const commentTable = new Map(
    (comments ?? SEED_COMMENTS).map((comment) => [comment.id, { ...comment }]),
  );
  let nextCommentId = (commentTable.size === 0 ? 0 : Math.max(...commentTable.keys())) + 1;

  const friendIds = (userId) => {
    const followees = edgeTable.get(userId) ?? new Set();
    return [...followees]
      .filter((followee) => edgeTable.get(followee)?.has(userId) ?? false)
      .sort((a, b) => a - b);
  };

  const mutualFriendIds = (v, a) => {
    const friendsOfA = new Set(friendIds(a));
    return friendIds(v).filter((id) => friendsOfA.has(id));
  };

  /** 按帖过滤 + created_at 升序（并列按 tieBreak 稳定），返回内部记录引用。 */
  const entriesInPosts = (table, postIds, tieBreak) => {
    const ids = new Set(postIds);
    return [...table.values()]
      .filter((entry) => ids.has(entry.post_id))
      .sort((a, b) => byInstant(a, b) || tieBreak(a, b));
  };

  return {
    /** 点赞：幂等（同 (postId, userId) 恰一条），无返回值（契约未定义返回形状）。 */
    likePost(postId, userId) {
      const key = likeKey(postId, userId);
      if (!likeTable.has(key)) {
        likeTable.set(key, { post_id: postId, user_id: userId, created_at: now() });
      }
    },

    /** 取消点赞：幂等（未点赞时静默）。 */
    unlikePost(postId, userId) {
      likeTable.delete(likeKey(postId, userId));
    },

    getLikesByPostIds(postIds) {
      return entriesInPosts(likeTable, postIds, byPostAndUser).map((like) => ({ ...like }));
    },

    /** 评论：id 自增（种子最大 id 续起）；内容校验不在本层（归 FP-008 路由）。 */
    createComment(postId, userId, content) {
      const comment = {
        id: nextCommentId++,
        post_id: postId,
        user_id: userId,
        content,
        created_at: now(),
      };
      commentTable.set(comment.id, comment);
      return { ...comment };
    },

    getCommentsByPostIds(postIds) {
      return entriesInPosts(commentTable, postIds, byId).map((comment) => ({ ...comment }));
    },

    /** 双向互关集合（升序副本）。 */
    friendIds,

    /** 好友(v) ∩ 好友(a)（升序副本）。 */
    mutualFriendIds,

    /**
     * 可见互动（逐帖按输入顺序）：可见集＝好友(V)∩好友(A)∪{V}；帖主自互动
     * 自然排除；查看者自身恒可见；无互动帖 → 空数组与 0 计数（空态可模拟）。
     */
    getVisibleInteractions(viewerId, posts) {
      return (posts ?? []).map((post) => {
        const visibleActors = new Set(mutualFriendIds(viewerId, post.author_id));
        visibleActors.add(viewerId);

        const likes = entriesInPosts(likeTable, [post.id], byPostAndUser)
          .filter((like) => visibleActors.has(like.user_id))
          .map(({ user_id, created_at }) => ({ user_id, created_at }));
        const comments = entriesInPosts(commentTable, [post.id], byId)
          .filter((comment) => visibleActors.has(comment.user_id))
          .map(({ id, user_id, content, created_at }) => ({ id, user_id, content, created_at }));

        return {
          post_id: post.id,
          likes,
          comments,
          visible_like_count: likes.length,
          visible_comment_count: comments.length,
        };
      });
    },
  };
}
