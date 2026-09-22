"""FP-004 互动可见性判定服务：好友帖子点赞 / 评论的共同好友可见性过滤.

领域口径（任务卡 §2，唯一依据）：
  好友 X        ＝ 与 X 双向互关者（FP-003 ``friendIds`` 口径）
  可见集(V, A)  ＝ (好友(V) ∩ 好友(A)) ∪ {V}

互动者 ∈ 可见集则其点赞 / 评论对 V 可见，集外一律不可见：查看者自身恒在
集内（D5 特例，对自己总可见）；帖主不是自己的好友，自互动按同公式自然
排除、无需特判；好友帖主与非好友帖主走同一条交集规则（D2 统一口径）；
仅返回可见计数，不携带任何「存在被隐藏内容」的信息（D8）；可见性按
follows 当前边实时判定、无快照。

本服务是全部读取路径的唯一过滤点（写入路径不经过本服务），不直连 SQL，
仅经 store 注入消费 FP-001 / FP-002 / FP-003 三组读契约（getLikesByPostIds /
getCommentsByPostIds / mutualFriendIds，任务卡 §3.2），任一满足形状的
实现均可替换（§6 内存 Stub）。
"""

from datetime import datetime, timezone


def _instant(created_at):
    """排序键：ISO 8601 → 真实瞬间；naive 视为 UTC，跨时区偏移文本归一可比."""
    parsed = datetime.fromisoformat(created_at)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _group_by_post(entries):
    """按 post_id 分组为 {post_id: [entry, ...]}（批量取数后逐帖过滤）."""
    grouped = {}
    for entry in entries:
        grouped.setdefault(entry["post_id"], []).append(entry)
    return grouped


class InteractionVisibilityService:
    """互动可见性判定服务：可见集公式 + 帖子集合的可见点赞 / 评论过滤."""

    def __init__(self, store):
        self._store = store

    def visibleSet(self, viewer_id, author_id):
        """可见集(V, A) ＝ friendIds(V) ∩ friendIds(A) ∪ {V}，返回新 set 副本.

        空交集（无共同好友 / 未知用户）自然坍缩为 {viewer_id}，无错误分支。
        """
        return set(self._store.mutualFriendIds(viewer_id, author_id)) | {viewer_id}

    def getVisibleInteractions(self, viewer_id, posts):
        """逐帖返回可见点赞 / 评论与仅可见计数（帖子按输入顺序）.

        posts＝[{id, author_id, …}]；每帖返回
        {post_id, likes: [{user_id, created_at}], comments: [{id, user_id,
        content, created_at}], visible_like_count, visible_comment_count}：
        列表只含可见集内互动者，comments 按 created_at 真实瞬间升序
        （同时刻按 id 升序）、likes 同按瞬间升序；计数＝对应列表长度；
        可见集为空 → 空列表与 0 计数（D8：无任何隐藏量差信息）。
        """
        posts = list(posts)
        likes_by_post = _group_by_post(
            self._store.getLikesByPostIds([post["id"] for post in posts])
        )
        comments_by_post = _group_by_post(
            self._store.getCommentsByPostIds([post["id"] for post in posts])
        )

        visible_by_author = {}
        results = []
        for post in posts:
            author_id = post["author_id"]
            if author_id not in visible_by_author:
                visible_by_author[author_id] = self.visibleSet(viewer_id, author_id)
            visible = visible_by_author[author_id]

            likes = sorted(
                (like for like in likes_by_post.get(post["id"], ()) if like["user_id"] in visible),
                key=lambda like: (_instant(like["created_at"]), like["user_id"]),
            )
            comments = sorted(
                (
                    comment
                    for comment in comments_by_post.get(post["id"], ())
                    if comment["user_id"] in visible
                ),
                key=lambda comment: (_instant(comment["created_at"]), comment["id"]),
            )
            results.append(
                {
                    "post_id": post["id"],
                    "likes": [
                        {"user_id": like["user_id"], "created_at": like["created_at"]}
                        for like in likes
                    ],
                    "comments": [
                        {
                            "id": comment["id"],
                            "user_id": comment["user_id"],
                            "content": comment["content"],
                            "created_at": comment["created_at"],
                        }
                        for comment in comments
                    ],
                    "visible_like_count": len(likes),
                    "visible_comment_count": len(comments),
                }
            )
        return results
