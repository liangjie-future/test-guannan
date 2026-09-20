"""FP-011 关注关系规则：单向关注服务层.

规则（任务卡 §3.2 本任务提供的能力）：
- follower_id = followee_id       → 拒绝（「不可关注自己」，上游 D5）
- 被关注者不存在                  → 拒绝（「用户不存在」）
- 已关注                          → 幂等成功（仍恰一条边，不重复）
- 否则                            → 建立单向关系 follower→followee
                                  （无需对方确认、不自动反向关注）

仅依赖 §3.2 契约形状（addFollow / followExists / getFolloweeIds / getUserById），
FP-001 未合入时可替换为内存模拟（见 docs/designs/FP-011-follow-rules.md §Mock）。
"""


class FollowError(Exception):
    """关注规则错误基类（调用方可统一捕获）."""


class SelfFollowNotAllowedError(FollowError):
    """不可关注自己（上游 D5：保证时间线语义清晰）."""


class FolloweeNotFoundError(FollowError):
    """被关注者不存在."""


class FollowService:
    """关注关系规则服务：组合任意满足 FP-001 §3.2 契约的存储."""

    def __init__(self, store):
        self._store = store

    def follow(self, follower_id, followee_id):
        """建立单向关注 follower→followee；自关注 / 被关注者不存在则拒绝.

        幂等：已关注时静默成功，不产生第二条边。无返回值（契约未定义，
        需区分新建 / 已存在时调用方可查 followExists）。
        """
        if follower_id == followee_id:
            raise SelfFollowNotAllowedError("不可关注自己")
        if self._store.getUserById(followee_id) is None:
            raise FolloweeNotFoundError("用户不存在")
        self._store.addFollow(follower_id, followee_id)

    def getFollowees(self, user_id):
        """被关注者 id 集合（时间线聚合 FP-015 与页面已关注态 FP-010 的数据来源）."""
        return self._store.getFolloweeIds(user_id)
