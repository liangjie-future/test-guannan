"""FP-016 好友帖子的点赞评论共同好友可见性：互动服务层.

 术语（单向关注图上的映射，见 docs/designs/FP-016-mutual-friend-engagement-visibility.md）：
   好友 X        = X 关注的人（getFolloweeIds(X)，与 FP-015 时间线同口径）
   共同好友(V,A) = F(V) ∩ F(A)

 可见性规则（核心）——查看者 V 查看作者 A 的帖子时：

   W(V, A) = {V, A} ∪ (F(V) ∩ F(A))

 即仅共同好友、查看者本人与帖主的点赞 / 评论可见（微信朋友圈「朋友点赞评论
 可见」语义）；其余任何人（单方好友 / 陌生人）的互动一律不可见。规则对
 非好友的帖子统一适用，不特判。

 写路径带规则（对齐 FP-013 三态），读路径无错误分支（对齐 FP-015 自然坍缩）。
 仅依赖 FP-001 §3.2 契约形状（getUserById / getPostById / getFolloweeIds /
 addLike / getLikesByPostId / addComment / getCommentsByPostId），可换内存模拟。
"""

from datetime import datetime, timezone

MAX_COMMENT_LENGTH = 280

STATUS_OK = "OK"
STATUS_ERROR = "ERROR"

REASON_USER_NOT_FOUND = "USER_NOT_FOUND"
REASON_POST_NOT_FOUND = "POST_NOT_FOUND"
REASON_EMPTY_CONTENT = "EMPTY_CONTENT"
REASON_TOO_LONG = "TOO_LONG"


def _instant(created_at):
    """排序键：ISO 8601 → datetime；naive 视为 UTC，保证按真实瞬间可比."""
    parsed = datetime.fromisoformat(created_at)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


class EngagementService:
    """互动服务：点赞 / 评论写入规则 + 好友帖子互动的共同好友可见性过滤."""

    def __init__(self, store):
        self._store = store

    def like(self, user_id, post_id):
        """点赞（幂等）.

        成功 → {"status": "OK", "created": bool}（新建 / 已点过）；
        失败 → {"status": "ERROR", "reason": USER_NOT_FOUND | POST_NOT_FOUND}；
        校验顺序：用户存在 → 帖子存在；失败不写入。
        """
        if self._store.getUserById(user_id) is None:
            return self._error(REASON_USER_NOT_FOUND)
        if self._store.getPostById(post_id) is None:
            return self._error(REASON_POST_NOT_FOUND)
        return {"status": STATUS_OK, "created": self._store.addLike(post_id, user_id)}

    def comment(self, user_id, post_id, content):
        """评论：1–280 字非空纯文本（去首尾空白后按码点计，口径同 FP-013）.

        成功 → {"status": "OK", "comment": {id, post_id, user_id, content, created_at}}；
        失败 → {"status": "ERROR",
                 "reason": USER_NOT_FOUND | POST_NOT_FOUND | EMPTY_CONTENT | TOO_LONG}；
        校验顺序：用户存在 → 帖子存在 → 内容非空 → 长度 ≤ 280；失败不写入。
        """
        if not isinstance(content, str):
            raise TypeError(f"content 必须为字符串，收到 {type(content).__name__}")

        if self._store.getUserById(user_id) is None:
            return self._error(REASON_USER_NOT_FOUND)
        if self._store.getPostById(post_id) is None:
            return self._error(REASON_POST_NOT_FOUND)

        text = content.strip()
        if not text:
            return self._error(REASON_EMPTY_CONTENT)
        if len(text) > MAX_COMMENT_LENGTH:
            return self._error(REASON_TOO_LONG)

        return {
            "status": STATUS_OK,
            "comment": self._store.addComment(post_id, user_id, text),
        }

    def getVisibleEngagement(self, viewer_id, post_id):
        """按共同好友可见性返回帖子的可见点赞与评论.

        返回 {"post_id", "likes": [...], "comments": [...]}：条目为存储字段的
        浅副本并补全 username（行为者缺失时为 None，防御口径），各按 created_at
        真实瞬间升序（并列稳定）。查询无错误分支：帖子不存在 → 两组皆空
        （自然坍缩，口径同 FP-015）。
        """
        result = {"post_id": post_id, "likes": [], "comments": []}
        post = self._store.getPostById(post_id)
        if post is None:
            return result

        visible_actors = self._visibleActorIds(viewer_id, post["author_id"])
        result["likes"] = self._visible_sorted(
            self._store.getLikesByPostId(post_id), visible_actors
        )
        result["comments"] = self._visible_sorted(
            self._store.getCommentsByPostId(post_id), visible_actors
        )
        return result

    def _visibleActorIds(self, viewer_id, author_id):
        """W(V, A) = {V, A} ∪ (F(V) ∩ F(A))：查看者 / 帖主 / 共同好友."""
        mutual_friends = set(self._store.getFolloweeIds(viewer_id)) & set(
            self._store.getFolloweeIds(author_id)
        )
        return {viewer_id, author_id} | mutual_friends

    def _visible_sorted(self, entries, visible_actors):
        """过滤到可见行为者 → 补全 username → 按时间瞬间升序（副本，不污染存储形状）."""
        visible = [
            self._with_username(entry)
            for entry in entries
            if entry["user_id"] in visible_actors
        ]
        visible.sort(key=lambda entry: _instant(entry["created_at"]))
        return visible

    def _with_username(self, entry):
        user = self._store.getUserById(entry["user_id"])
        enriched = dict(entry)
        enriched["username"] = user["username"] if user else None
        return enriched

    @staticmethod
    def _error(reason):
        return {"status": STATUS_ERROR, "reason": reason}
