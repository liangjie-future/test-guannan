"""FP-015 时间线聚合与排序：getTimeline 服务.

 管线（任务卡 §3.2 本任务提供的能力）：
   getFolloweeIds(user_id)
     → getPostsByAuthorIds(followee_ids)
     → 范围过滤（不含自己 / 不含未关注者，上游 D7）
     → created_at 倒序（新帖在前；同时刻次序不限定）

 仅依赖 §3.2 契约形状（getFolloweeIds / getPostsByAuthorIds / getUserById），
 FP-001 未合入时可替换为内存模拟（见 docs/designs/FP-015-timeline-aggregate-sort.md）。
 作者信息补全口径：本任务一并补齐——条目 = 帖子字段 + author_username.
"""

from datetime import datetime, timezone


def _instant(created_at):
    """排序键：ISO 8601 → datetime；naive 视为 UTC，保证按真实瞬间可比."""
    parsed = datetime.fromisoformat(created_at)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


class TimelineService:
    """时间线服务：组合任意满足 FP-001 §3.2 契约的存储."""

    def __init__(self, store):
        self._store = store

    def getTimeline(self, user_id):
        """聚合被关注对象的帖子并按发布时间倒序返回.

        范围：仅该用户全部被关注对象的帖子——不含自己的、不含未关注者的；
        空态：未关注任何人 → 空集合。条目为帖子字段的副本并补全作者名。
        """
        followee_ids = set(self._store.getFolloweeIds(user_id))
        if not followee_ids:
            return []

        posts = self._store.getPostsByAuthorIds(followee_ids)
        entries = [
            self._with_author(post)
            for post in posts
            # 范围过滤：不含自己（上游 D7）/ 不含未关注者
            if post["author_id"] != user_id and post["author_id"] in followee_ids
        ]
        entries.sort(key=lambda entry: _instant(entry["created_at"]), reverse=True)
        return entries

    def _with_author(self, post):
        author = self._store.getUserById(post["author_id"])
        entry = dict(post)  # 副本：补全字段不污染存储层形状
        entry["author_username"] = author["username"] if author else None
        return entry
