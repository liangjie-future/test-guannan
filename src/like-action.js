/**
 * FP-007 点赞动作（任务卡 §4）：toggle 切换点赞 / 取消的规则层与路径解析。
 *
 * 只依赖 §3.2 点赞存取契约形状（likePost / unlikePost / getLikesByPostIds，
 * FP-001 Python 侧与 FP-005 Node 内存 Mock 同形），鸭子类型注入——
 * Python SQLite 持久化桥接属集成点，替换注入零改动。
 * 动作语义（登录门槛 + PRG 302 /timeline）由 src/server.js 组装，
 * 风格对齐既有 /users/<id>/follow 关注动作。
 */

const LIKE_ACTION_PATTERN = /^\/posts\/(\d+)\/like$/;

/** `/posts/<id>/like` → id；其余路径 → null。 */
export function parseLikeActionPath(pathname) {
  const match = LIKE_ACTION_PATTERN.exec(pathname);
  return match === null ? null : Number(match[1]);
}

export function createLikeActionService({ store }) {
  if (!store) {
    throw new Error('createLikeActionService: store is required');
  }

  return {
    /**
     * toggle：目标帖点赞中存在 (post, user) → 取消；不存在 → 点赞。
     * 重复 / 并发提交最终恰一条（本层判定 + 存原语幂等两端一致）。
     * 帖主自赞不设防（上游 D3 推导口径：存储不设防、界面无入口）。
     */
    toggleLike(postId, userId) {
      const liked = store.getLikesByPostIds([postId]).some((like) => like.user_id === userId);
      if (liked) {
        store.unlikePost(postId, userId);
      } else {
        store.likePost(postId, userId);
      }
    },
  };
}
