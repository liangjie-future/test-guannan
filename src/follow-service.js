/**
 * FP-011 关注关系规则的 Node 侧适配（任务卡 §3.2 依赖能力）。
 *
 * 规则语义与 services/follow.py 一致（自关注拒绝 → 被关注者不存在拒绝 →
 * 幂等建边）；差异仅在于 Web 层需要可判定的结果反馈而非异常：
 *   follow(f, g) → {status:'OK', created:true}          新建单向边
 *                | {status:'OK', created:false}         已关注（幂等成功）
 *                | {status:'ERROR', reason:'SELF_FOLLOW_NOT_ALLOWED'}
 *                | {status:'ERROR', reason:'FOLLOWEE_NOT_FOUND'}
 */
export function createFollowService({ store }) {
  if (!store) {
    throw new Error('createFollowService: store is required');
  }

  return {
    follow(followerId, followeeId) {
      if (followerId === followeeId) {
        return { status: 'ERROR', reason: 'SELF_FOLLOW_NOT_ALLOWED' };
      }
      if (store.getUserById(followeeId) === null) {
        return { status: 'ERROR', reason: 'FOLLOWEE_NOT_FOUND' };
      }
      const existed = store.followExists(followerId, followeeId);
      if (!existed) store.addFollow(followerId, followeeId);
      return { status: 'OK', created: !existed };
    },

    /** 被关注者 id 集合（页面已关注态数据来源，任务卡 §3.2）。 */
    getFolloweeIds(userId) {
      return store.getFolloweeIds(userId);
    },
  };
}
