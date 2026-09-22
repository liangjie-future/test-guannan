"""FP-016 好友帖子的点赞评论共同好友可见性 —— 测试套件.

对应 docs/test-cases/FP-016-mutual-friend-engagement-visibility.md（TC-01 ~ TC-12）。
"""

import sqlite3

import pytest

from services.engagement import (
    REASON_EMPTY_CONTENT,
    REASON_POST_NOT_FOUND,
    REASON_TOO_LONG,
    REASON_USER_NOT_FOUND,
    EngagementService,
)
from storage import DataStore

# §种子时间戳：T1 < T2 < T3；OFFSET 即时 = 09:30 UTC（字典序会排错位）；
# TIE_OFFSET 即时 = 10:00 UTC（与 T3 真实瞬间并列）
T1 = "2026-09-20T08:00:00+00:00"
T2 = "2026-09-20T09:00:00+00:00"
T3 = "2026-09-20T10:00:00+00:00"
OFFSET = "2026-09-20T11:30:00+02:00"  # = 09:30 UTC，字典序晚于 T3
TIE_OFFSET = "2026-09-20T12:00:00+02:00"  # = 10:00 UTC，与 T3 并列

# V=1 查看者 / A=2 帖主 / C=3 共同好友 / D=4 仅帖主好友 / E=5 陌生人
USERS = (
    ("alice", 1),
    ("bob", 2),
    ("carol", 3),
    ("dave", 4),
    ("erin", 5),
)
# F(V)={A,C}，F(A)={C,D} → 共同好友(V,A)={C}，W(V,A)={V,A,C}
DEFAULT_FOLLOWS = ((1, 2), (1, 3), (2, 3), (2, 4))

P = 1  # 种子中 A 的帖子 id（显式直插）


@pytest.fixture()
def store(tmp_path):
    """真实 FP-001 存储：每个测试独立 SQLite 文件."""
    s = DataStore(tmp_path / "social.db")
    yield s
    s.close()


def seed(
    store,
    users=USERS,
    follows=DEFAULT_FOLLOWS,
    posts=((P, 2, "b-post", T1),),
    likes=(),
    comments=(),
):
    """§种子：用户 / 关注边 / 帖子 / 点赞 / 评论可按场景裁剪.

    互动以显式时间戳直插（created_at 为 TEXT 列），保证时序确定。
    """
    con = sqlite3.connect(store.path)
    try:
        for name, uid in users:
            con.execute(
                "INSERT INTO users (id, username, password_hash, salt, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (uid, name, f"h{uid}", f"s{uid}", T1),
            )
        for follower, followee in follows:
            con.execute(
                "INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)",
                (follower, followee),
            )
        for post_id, author_id, content, created_at in posts:
            con.execute(
                "INSERT INTO posts (id, author_id, content, created_at)"
                " VALUES (?, ?, ?, ?)",
                (post_id, author_id, content, created_at),
            )
        for post_id, user_id, created_at in likes:
            con.execute(
                "INSERT INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)",
                (post_id, user_id, created_at),
            )
        for post_id, user_id, content, created_at in comments:
            con.execute(
                "INSERT INTO comments (post_id, user_id, content, created_at)"
                " VALUES (?, ?, ?, ?)",
                (post_id, user_id, content, created_at),
            )
        con.commit()
    finally:
        con.close()
    return {uid: name for name, uid in users}


def service_on(store):
    return EngagementService(store)


# ------------------------------------------- TC-01 点赞写入：成功与幂等


class TestLikeWrite:
    def test_like_ok_then_idempotent(self, store):
        seed(store)

        first = service_on(store).like(1, P)
        second = service_on(store).like(1, P)

        assert first == {"status": "OK", "created": True}
        assert second == {"status": "OK", "created": False}
        assert len(store.getLikesByPostId(P)) == 1  # 不产生第二条

    def test_like_own_post_allowed(self, store):
        seed(store)

        assert service_on(store).like(2, P)["status"] == "OK"


# ------------------------------------------- TC-02 评论写入：成功与内容规则


class TestCommentWrite:
    def test_comment_ok_returns_full_object(self, store):
        seed(store)

        result = service_on(store).comment(3, P, "  nice post  ")

        assert result["status"] == "OK"
        comment = result["comment"]
        assert set(comment) == {"id", "post_id", "user_id", "content", "created_at"}
        assert comment["post_id"] == P
        assert comment["user_id"] == 3
        assert comment["content"] == "nice post"  # 去首尾空白后落库
        assert comment["created_at"]

    def test_empty_or_whitespace_rejected(self, store):
        seed(store)
        svc = service_on(store)

        assert svc.comment(3, P, "")["reason"] == REASON_EMPTY_CONTENT
        assert svc.comment(3, P, "   \n\t ")["reason"] == REASON_EMPTY_CONTENT
        assert store.getCommentsByPostId(P) == []  # 失败不落评论

    def test_length_boundary(self, store):
        seed(store)
        svc = service_on(store)

        assert svc.comment(3, P, "x" * 281)["reason"] == REASON_TOO_LONG
        assert svc.comment(3, P, "x" * 280)["status"] == "OK"  # 恰 280 含边界

    def test_non_string_content_raises_type_error(self, store):
        seed(store)

        with pytest.raises(TypeError):
            service_on(store).comment(3, P, 123)


# ------------------------------------------- TC-03 写入错误路径与校验顺序


class TestWriteErrors:
    def test_unknown_user_rejected(self, store):
        seed(store)
        svc = service_on(store)

        assert svc.like(999, P)["reason"] == REASON_USER_NOT_FOUND
        assert svc.comment(999, P, "hi")["reason"] == REASON_USER_NOT_FOUND

    def test_unknown_post_rejected(self, store):
        seed(store)
        svc = service_on(store)

        assert svc.like(3, 999)["reason"] == REASON_POST_NOT_FOUND
        assert svc.comment(3, 999, "hi")["reason"] == REASON_POST_NOT_FOUND

    def test_validation_order_user_first_then_post_then_content(self, store):
        seed(store)
        svc = service_on(store)

        # 用户不存在优先于帖子不存在 / 内容规则
        assert svc.comment(999, 999, "")["reason"] == REASON_USER_NOT_FOUND
        # 帖子不存在优先于内容规则
        assert svc.comment(3, 999, "")["reason"] == REASON_POST_NOT_FOUND

    def test_failures_write_nothing(self, store):
        seed(store)
        svc = service_on(store)

        svc.like(999, P)
        svc.like(3, 999)
        svc.comment(999, P, "hi")
        svc.comment(3, 999, "hi")
        svc.comment(3, P, " ")
        svc.comment(3, P, "x" * 281)

        assert store.getLikesByPostId(P) == []
        assert store.getCommentsByPostId(P) == []


# ------------------------------------------- TC-04 可见性核心（验收主场景）


class TestVisibilityCore:
    def test_only_mutual_friend_engagement_visible(self, store):
        seed(
            store,
            likes=[(P, 3, T1), (P, 4, T2), (P, 5, T3)],
            comments=[(P, 3, "c-nice", T1), (P, 4, "d-hi", T2), (P, 5, "e-hi", T3)],
        )

        result = service_on(store).getVisibleEngagement(1, P)

        assert result["post_id"] == P
        assert [like["user_id"] for like in result["likes"]] == [3]  # 仅共同好友 C
        assert [c["user_id"] for c in result["comments"]] == [3]
        assert result["likes"][0]["username"] == "carol"
        assert result["comments"][0]["content"] == "c-nice"

    def test_single_side_friend_and_stranger_fully_hidden(self, store):
        seed(
            store,
            likes=[(P, 4, T1), (P, 5, T2)],
            comments=[(P, 4, "d-hi", T1), (P, 5, "e-hi", T2)],
        )

        result = service_on(store).getVisibleEngagement(1, P)

        assert result["likes"] == []  # D（仅帖主好友）与 E（陌生人）均不可见
        assert result["comments"] == []


# ------------------------------------------- TC-05 自己与帖主例外（设计口径）


class TestSelfAndAuthorVisible:
    def test_viewer_and_author_own_engagement_visible(self, store):
        seed(
            store,
            likes=[(P, 1, T1), (P, 2, T2), (P, 4, T3)],
            comments=[(P, 1, "v-self", T1), (P, 2, "a-reply", T2), (P, 4, "d-hi", T3)],
        )

        result = service_on(store).getVisibleEngagement(1, P)

        assert {like["user_id"] for like in result["likes"]} == {1, 2}  # V 与 A
        assert {c["content"] for c in result["comments"]} == {"v-self", "a-reply"}


# ------------------------------------------- TC-06 空态与查询坍缩（边界）


class TestEmptyAndCollapse:
    def test_post_without_engagement_yields_empty_lists(self, store):
        seed(store)

        result = service_on(store).getVisibleEngagement(1, P)

        assert result == {"post_id": P, "likes": [], "comments": []}

    def test_unknown_post_collapses_to_empty_without_error(self, store):
        seed(store)

        result = service_on(store).getVisibleEngagement(1, 999)

        assert result == {"post_id": 999, "likes": [], "comments": []}

    def test_unknown_viewer_collapses_without_crash(self, store):
        # W(999, A) = {999, A}：仅帖主自身互动可见
        seed(store, likes=[(P, 2, T1), (P, 3, T2), (P, 4, T3)])

        result = service_on(store).getVisibleEngagement(999, P)

        assert [like["user_id"] for like in result["likes"]] == [2]


# ------------------------------------------- TC-07 帖主查看自己的帖子


class TestAuthorViewsOwnPost:
    def test_author_sees_own_friends_but_not_strangers(self, store):
        # W(A, A) = {A} ∪ F(A) = {A, C, D}：E（帖主也不认识）不可见
        seed(
            store,
            likes=[(P, 3, T1), (P, 4, T2), (P, 5, T3)],
            comments=[(P, 3, "c-nice", T1), (P, 4, "d-hi", T2), (P, 5, "e-hi", T3)],
        )

        result = service_on(store).getVisibleEngagement(2, P)

        assert {like["user_id"] for like in result["likes"]} == {3, 4}
        assert {c["user_id"] for c in result["comments"]} == {3, 4}


# ------------------------------------------- TC-08 非好友帖子统一规则（边界）


class TestNonFriendPostRule:
    def test_rule_applies_uniformly_to_non_friend_post(self, store):
        # 变体：新增作者 X=frank(6)，X 关注 C（共同好友(V,X)={C}），V 未关注 X
        users = USERS + (("frank", 6),)
        follows = DEFAULT_FOLLOWS + ((6, 3),)
        seed(
            store,
            users=users,
            follows=follows,
            posts=((P, 2, "b-post", T1), (2, 6, "x-post", T1)),
            likes=[(2, 3, T1), (2, 4, T2), (2, 5, T3), (2, 1, T2), (2, 6, T3)],
            comments=[(2, 3, "c-nice", T1), (2, 4, "d-hi", T2), (2, 5, "e-hi", T3)],
        )

        result = service_on(store).getVisibleEngagement(1, 2)

        # 可见 = {V, X, C}：共同好友 C、自己 V、帖主 X；D / E 不可见
        assert {like["user_id"] for like in result["likes"]} == {1, 3, 6}
        assert {c["user_id"] for c in result["comments"]} == {3}


# --------------------------- TC-09 关注图变化即时反映（FP-011 联调面）


class TestFollowGraphDrivesVisibility:
    def test_without_follow_edge_mutual_friend_hidden(self, store):
        # 变体：去掉 V→C 边 → 共同好友(V,A)=∅，W={V,A}
        seed(
            store,
            follows=((1, 2), (2, 3), (2, 4)),
            likes=[(P, 3, T1), (P, 4, T2)],
            comments=[(P, 3, "c-nice", T1)],
        )

        result = service_on(store).getVisibleEngagement(1, P)

        assert result["likes"] == []
        assert result["comments"] == []

    def test_new_follow_makes_engagement_visible_immediately(self, store):
        seed(store, likes=[(P, 4, T1)], comments=[(P, 4, "d-hi", T1)])

        before = service_on(store).getVisibleEngagement(1, P)
        store.addFollow(1, 4)  # V 新关注 D → D 成为共同好友
        after = service_on(store).getVisibleEngagement(1, P)

        assert before["likes"] == []
        assert [like["user_id"] for like in after["likes"]] == [4]
        assert [c["content"] for c in after["comments"]] == ["d-hi"]


# ------------------------------------------- TC-10 排序：时间瞬间升序与并列稳定


class TestOrdering:
    def test_likes_sorted_by_instant_not_lexicographic(self, store):
        # V@OFFSET=09:30 UTC 真实早于 C@T3=10:00 UTC，但字典序更晚
        seed(store, likes=[(P, 3, T3), (P, 1, OFFSET)])

        result = service_on(store).getVisibleEngagement(1, P)

        assert [like["user_id"] for like in result["likes"]] == [1, 3]

    def test_comments_sorted_ascending_with_stable_ties(self, store):
        seed(
            store,
            comments=[
                (P, 2, "a-early", T1),  # A@T1 最早，唯一首位
                (P, 1, "v-tie", T3),  # 与下行真实瞬间并列（10:00 UTC）
                (P, 3, "c-tie", TIE_OFFSET),
            ],
        )

        result = service_on(store).getVisibleEngagement(1, P)

        contents = [c["content"] for c in result["comments"]]
        assert contents[0] == "a-early"
        assert set(contents[1:]) == {"v-tie", "c-tie"}  # 并列均出现，次序不限定


# ------------------------------------------- TC-11 存储原语与持久化（FP-001 扩展）


class TestStoragePrimitives:
    def test_get_post_by_id(self, store):
        seed(store)

        post = store.getPostById(P)
        assert post == {
            "id": P,
            "author_id": 2,
            "content": "b-post",
            "created_at": T1,
        }
        assert store.getPostById(999) is None

    def test_add_like_idempotent_single_row(self, store):
        seed(store)

        assert store.addLike(P, 3) is True
        assert store.addLike(P, 3) is False

        rows = store.getLikesByPostId(P)
        assert len(rows) == 1
        assert rows[0]["post_id"] == P
        assert rows[0]["user_id"] == 3
        assert rows[0]["created_at"]

    def test_engagement_scoped_to_post(self, store):
        seed(
            store,
            posts=((P, 2, "b-post", T1), (2, 2, "b-other", T1)),
            likes=[(P, 3, T1), (2, 4, T2)],
            comments=[(P, 3, "c-nice", T1), (2, 4, "d-hi", T2)],
        )

        likes = store.getLikesByPostId(P)
        comments = store.getCommentsByPostId(P)

        assert [like["user_id"] for like in likes] == [3]  # 不混入他帖
        assert [c["user_id"] for c in comments] == [3]

    def test_add_comment_returns_full_object(self, store):
        seed(store)

        comment = store.addComment(P, 3, "hello")

        assert set(comment) == {"id", "post_id", "user_id", "content", "created_at"}
        assert comment in store.getCommentsByPostId(P)

    def test_engagement_survives_restart(self, store):
        seed(store, likes=[(P, 3, T1)], comments=[(P, 3, "c-nice", T2)])
        path = store.path

        store.close()
        reopened = DataStore(path)
        try:
            assert [like["user_id"] for like in reopened.getLikesByPostId(P)] == [3]
            assert [c["content"] for c in reopened.getCommentsByPostId(P)] == ["c-nice"]
        finally:
            reopened.close()


# ------------------------------------------- TC-12 内存契约替身路径（§6 Mock）


class InMemoryContractStore:
    """§6：内存模拟——仅实现 EngagementService 消费的读侧契约方法."""

    def __init__(self, users, posts, follows, likes, comments):
        self._users = {uid: {"id": uid, "username": name} for uid, name in users}
        self._posts = {p["id"]: dict(p) for p in posts}
        self._follows = set(follows)
        self._likes = [dict(like) for like in likes]
        self._comments = [dict(c) for c in comments]

    def getUserById(self, id):
        user = self._users.get(id)
        return dict(user) if user else None  # 副本：与 DataStore 行为一致

    def getPostById(self, id):
        post = self._posts.get(id)
        return dict(post) if post else None

    def getFolloweeIds(self, user_id):
        return [followee for (follower, followee) in self._follows if follower == user_id]

    def getLikesByPostId(self, post_id):
        return [dict(like) for like in self._likes if like["post_id"] == post_id]

    def getCommentsByPostId(self, post_id):
        return [dict(c) for c in self._comments if c["post_id"] == post_id]


def mock_full():
    return InMemoryContractStore(
        users=((1, "alice"), (2, "bob"), (3, "carol"), (4, "dave"), (5, "erin")),
        posts=[{"id": P, "author_id": 2, "content": "b-post", "created_at": T1}],
        follows=DEFAULT_FOLLOWS,
        likes=[{"post_id": P, "user_id": 3, "created_at": T1}, {"post_id": P, "user_id": 4, "created_at": T2}],
        comments=[
            {"id": 1, "post_id": P, "user_id": 3, "content": "c-nice", "created_at": T1},
            {"id": 2, "post_id": P, "user_id": 5, "content": "e-hi", "created_at": T2},
        ],
    )


class TestInMemoryMockPath:
    def test_mutual_visible_others_hidden_against_mock(self):
        result = EngagementService(mock_full()).getVisibleEngagement(1, P)

        assert [like["user_id"] for like in result["likes"]] == [3]
        assert [c["user_id"] for c in result["comments"]] == [3]

    def test_missing_actor_username_is_none_not_crash(self):
        store = mock_full()
        del store._users[3]  # 防御口径：行为者缺失不崩溃

        result = EngagementService(store).getVisibleEngagement(1, P)

        assert result["likes"][0]["username"] is None

    def test_returned_entries_are_copies(self):
        store = mock_full()
        svc = EngagementService(store)

        first = svc.getVisibleEngagement(1, P)
        first["likes"][0]["username"] = "hacker"
        first["comments"][0]["content"] = "mutated"

        again = svc.getVisibleEngagement(1, P)
        assert again["likes"][0]["username"] == "carol"
        assert again["comments"][0]["content"] == "c-nice"
