"""FP-004 互动可见性判定服务 —— 测试套件.

对应 docs/test-cases/FP-004-interaction-visibility.md（TC-01 ~ TC-11），
全部用例走 §6 内存 Stub 种子，不依赖其他任务运行时产出。
"""

import pytest

from services.interactions import InteractionVisibilityService

# §种子时间戳：T1 < T2 < T3 < T4；OFFSET 即时 = 09:00 UTC（字典序晚于 T4，
# 验证瞬间归一）；TIE 与 T2 真实瞬间并列（同时刻按 id 升序）
T1 = "2026-02-01T08:00:00+00:00"
T2 = "2026-02-01T09:00:00+00:00"
T3 = "2026-02-01T10:00:00+00:00"
T4 = "2026-02-01T11:00:00+00:00"
OFFSET = "2026-02-01T12:00:00+02:00"  # = 10:00 UTC，字典序晚于 T4
TIE_OFFSET = "2026-02-01T12:00:00+03:00"  # = 09:00 UTC，与 T2 并列

ALICE, BOB, CAROL, DAVE, ERIN = 1, 2, 3, 4, 5

# 互关边 alice↔bob、alice↔carol、bob↔carol、bob↔dave（双向各一条）：
# 好友(alice)={bob,carol}、好友(bob)={alice,carol,dave}、共同好友(alice,bob)={carol}
SEED_EDGES = (
    (ALICE, BOB),
    (BOB, ALICE),
    (ALICE, CAROL),
    (CAROL, ALICE),
    (BOB, CAROL),
    (CAROL, BOB),
    (BOB, DAVE),
    (DAVE, BOB),
)

P1 = {"id": 1, "author_id": BOB, "content": "bob 的帖子"}

# 点赞：carol / dave / bob（帖主自赞）；插入序 ≠ 时间序（likes 契约「顺序不保证」）
SEED_LIKES = (
    {"post_id": 1, "user_id": DAVE, "created_at": T3},
    {"post_id": 1, "user_id": BOB, "created_at": T4},
    {"post_id": 1, "user_id": CAROL, "created_at": T1},
)

# 评论：c1 carol「+1」(t1)、c2 dave「同看」(t2)、c3 bob 自评 (t3)、c4 alice「路过」(t4)
SEED_COMMENTS = (
    {"id": 1, "post_id": 1, "user_id": CAROL, "content": "+1", "created_at": T1},
    {"id": 2, "post_id": 1, "user_id": DAVE, "content": "同看", "created_at": T2},
    {"id": 3, "post_id": 1, "user_id": BOB, "content": "谢谢大家", "created_at": T3},
    {"id": 4, "post_id": 1, "user_id": ALICE, "content": "路过", "created_at": T4},
)

RESULT_KEYS = {
    "post_id",
    "likes",
    "comments",
    "visible_like_count",
    "visible_comment_count",
}


class StubStore:
    """§6 Stub：§3.2 三组契约的最小内存实现（dict / Set），种子即标准场景."""

    def __init__(self, edges=SEED_EDGES, likes=SEED_LIKES, comments=SEED_COMMENTS):
        self._edges = set(edges)
        self._likes = {(like["post_id"], like["user_id"]): dict(like) for like in likes}
        self._comments = [dict(comment) for comment in comments]
        self._next_id = max((c["id"] for c in self._comments), default=0) + 1

    # ---------------- FP-003 好友推导（实时按当前边，无快照）

    def friendIds(self, user_id):
        return {
            followee
            for follower, followee in self._edges
            if follower == user_id and (followee, user_id) in self._edges
        }

    def mutualFriendIds(self, v, a):
        return self.friendIds(v) & self.friendIds(a)

    def removeFollow(self, follower, followee):
        """测试助手：直接删边（系统无取关原语，验收 4 的「从 Stub 删除」）."""
        self._edges.discard((follower, followee))

    # ---------------- FP-001 点赞存取

    def likePost(self, post_id, user_id):
        self._likes.setdefault(
            (post_id, user_id), {"post_id": post_id, "user_id": user_id, "created_at": T1}
        )

    def unlikePost(self, post_id, user_id):
        self._likes.pop((post_id, user_id), None)

    def getLikesByPostIds(self, post_ids):
        ids = set(post_ids)
        return [dict(like) for like in self._likes.values() if like["post_id"] in ids]

    # ---------------- FP-002 评论存取

    def createComment(self, post_id, user_id, content):
        comment = {
            "id": self._next_id,
            "post_id": post_id,
            "user_id": user_id,
            "content": content,
            "created_at": T1,
        }
        self._next_id += 1
        self._comments.append(comment)
        return dict(comment)

    def getCommentsByPostIds(self, post_ids):
        ids = set(post_ids)
        matched = [dict(c) for c in self._comments if c["post_id"] in ids]
        matched.sort(key=lambda c: (c["created_at"], c["id"]))
        return matched


def service_on(store=None):
    return InteractionVisibilityService(store or StubStore())


def view_p1(svc, viewer_id=ALICE):
    return svc.getVisibleInteractions(viewer_id, [P1])[0]


# ------------------------------------------- TC-01 visibleSet 公式直译


class TestVisibleSet:
    def test_formula_mutual_union_viewer(self):
        result = service_on().visibleSet(ALICE, BOB)

        assert result == {ALICE, CAROL}
        assert isinstance(result, set)
        assert BOB not in result  # 帖主不是自己的好友 → 不在集内

    def test_viewer_always_in_set_even_without_mutual(self):
        svc = service_on()

        assert svc.visibleSet(ERIN, BOB) == {ERIN}  # 无任何边 → 仅查看者
        assert svc.visibleSet(999, BOB) == {999}  # 未知用户自然坍缩

    def test_viewer_equals_author_degrades_to_own_friends(self):
        # 同参：交集退化为自身好友集，查看者＝帖主经 ∪{V} 入集（公式自然结果）
        result = service_on().visibleSet(BOB, BOB)

        assert result == {ALICE, BOB, CAROL, DAVE}


# ------------------------------------------- TC-02 标准场景过滤（验收 1）


class TestStandardScenario:
    def test_alice_views_p1(self):
        result = view_p1(service_on())

        assert set(result) == RESULT_KEYS  # D8：五键形状，无隐藏量差字段
        assert result["post_id"] == 1
        assert result["likes"] == [{"user_id": CAROL, "created_at": T1}]
        assert [c["id"] for c in result["comments"]] == [1, 4]  # c1 carol + c4 alice
        assert result["visible_like_count"] == 1
        assert result["visible_comment_count"] == 2

    def test_dave_engagement_hidden(self):
        result = view_p1(service_on())

        assert DAVE not in [like["user_id"] for like in result["likes"]]
        assert DAVE not in [c["user_id"] for c in result["comments"]]

    def test_comment_entry_shape(self):
        result = view_p1(service_on())

        assert set(result["comments"][0]) == {"id", "user_id", "content", "created_at"}
        assert result["comments"][0]["content"] == "+1"


# --------------------------- TC-03 帖主自互动自然排除（验收 2）


class TestAuthorSelfInteractionExcluded:
    def test_bob_self_like_and_comment_not_returned(self):
        store = StubStore()
        svc = service_on(store)

        assert BOB not in svc.visibleSet(ALICE, BOB)  # 公式自然结果而非特判
        assert BOB not in store.friendIds(BOB)  # 无人是自己的好友

        result = view_p1(svc)
        assert BOB not in [like["user_id"] for like in result["likes"]]
        assert 3 not in [c["id"] for c in result["comments"]]  # c3 bob 自评


# --------------------------- TC-04 查看者自身恒可见（验收 3，D5）


class TestViewerAlwaysVisible:
    def test_alice_own_comment_always_included(self):
        result = view_p1(service_on())

        assert 4 in [c["id"] for c in result["comments"]]
        assert result["visible_comment_count"] == 2  # c4 计入仅可见计数


# --------------------------- TC-05 删边实时生效（验收 4，无快照）


class TestEdgeRemovalRealTime:
    @pytest.mark.parametrize("edge", [(CAROL, BOB), (BOB, CAROL)])
    def test_removing_either_direction_hides_carol(self, edge):
        store = StubStore()
        svc = service_on(store)

        store.removeFollow(*edge)  # 解除 carol↔bob 互关的任一方向

        result = view_p1(svc)
        assert result["likes"] == []
        assert [c["id"] for c in result["comments"]] == [4]  # 仅剩 alice 自己
        assert result["visible_like_count"] == 0
        assert result["visible_comment_count"] == 1


# --------------------------- TC-06 非好友帖主统一规则（验收 5，D2）


class TestNonFriendAuthorUnifiedRule:
    def test_one_way_follow_still_uses_intersection_rule(self):
        store = StubStore(
            edges=((ALICE, BOB), (ALICE, CAROL), (CAROL, ALICE), (BOB, CAROL), (CAROL, BOB)),
            likes=(),
            comments=(
                {"id": 1, "post_id": 1, "user_id": CAROL, "content": "+1", "created_at": T1},
                {"id": 2, "post_id": 1, "user_id": DAVE, "content": "同看", "created_at": T2},
            ),
        )

        assert BOB not in store.friendIds(ALICE)  # 前置：好友(alice) 不含 bob
        assert store.mutualFriendIds(ALICE, BOB) == {CAROL}

        result = view_p1(service_on(store))
        assert [c["id"] for c in result["comments"]] == [1]  # carol 的评论可见


# --------------------------- TC-07 无边用户空态（验收 6）


class TestNoEdgeUserEmptyState:
    def test_erin_sees_empty_lists_and_zero_counts(self):
        svc = service_on()

        assert svc.visibleSet(ERIN, BOB) == {ERIN}

        result = view_p1(svc, viewer_id=ERIN)
        assert set(result) == RESULT_KEYS
        assert result["likes"] == []
        assert result["comments"] == []
        assert result["visible_like_count"] == 0
        assert result["visible_comment_count"] == 0


# --------------------------- TC-08 多帖集合与空入参（边界）


class TestMultiplePostsAndEmptyInput:
    def test_empty_posts_returns_empty_list(self):
        assert service_on().getVisibleInteractions(ALICE, []) == []

    def test_results_follow_input_order_with_empty_post(self):
        p2 = {"id": 2, "author_id": CAROL, "content": "carol 的帖子（无互动）"}

        results = service_on().getVisibleInteractions(ALICE, [p2, P1])

        assert [r["post_id"] for r in results] == [2, 1]  # 输入顺序
        assert results[0]["likes"] == []
        assert results[0]["comments"] == []
        assert results[0]["visible_like_count"] == 0
        assert results[0]["visible_comment_count"] == 0
        assert results[1]["visible_comment_count"] == 2  # P1 不受影响


# --------------------------- TC-09 排序：真实瞬间升序与并列按 id


class TestOrdering:
    def test_likes_sorted_by_created_at_ascending(self):
        # 插入序 carol(T4)/alice(T3)/dave(T1)：契约「顺序不保证」，
        # 可见者按真实瞬间升序输出（alice T3 → carol T4），dave 被过滤
        store = StubStore(
            likes=(
                {"post_id": 1, "user_id": CAROL, "created_at": T4},
                {"post_id": 1, "user_id": ALICE, "created_at": T3},
                {"post_id": 1, "user_id": DAVE, "created_at": T1},
            )
        )

        result = view_p1(service_on(store))

        assert [like["user_id"] for like in result["likes"]] == [ALICE, CAROL]
        assert [like["created_at"] for like in result["likes"]] == [T3, T4]

    def test_comments_tie_broken_by_id_ascending(self):
        store = StubStore(
            comments=(
                {"id": 7, "post_id": 1, "user_id": CAROL, "content": "早时大id", "created_at": T1},
                {"id": 5, "post_id": 1, "user_id": CAROL, "content": "并列小id", "created_at": TIE_OFFSET},
                {"id": 6, "post_id": 1, "user_id": ALICE, "content": "并列大id", "created_at": T2},
            )
        )
        # TIE_OFFSET 与 T2 同为 09:00 UTC：同时刻按 id 升序 → 5 先于 6

        result = view_p1(service_on(store))

        assert [c["id"] for c in result["comments"]] == [7, 5, 6]

    def test_offset_timestamps_sorted_by_instant_not_lexicographic(self):
        store = StubStore(
            comments=(
                {"id": 1, "post_id": 1, "user_id": CAROL, "content": "utc文本", "created_at": T4},
                {"id": 2, "post_id": 1, "user_id": ALICE, "content": "偏移文本", "created_at": OFFSET},
            )
        )
        # OFFSET = 10:00 UTC 真实早于 T4 = 11:00 UTC，但文本字典序更晚

        result = view_p1(service_on(store))

        assert [c["id"] for c in result["comments"]] == [2, 1]


# --------------------------- TC-10 返回值为副本（边界）


class TestReturnCopies:
    def test_mutating_results_does_not_affect_subsequent_queries(self):
        svc = service_on()

        first = view_p1(svc)
        first["likes"][0]["user_id"] = 999
        first["comments"][0]["content"] = "篡改"
        first["visible_like_count"] = 999

        again = view_p1(svc)
        assert again["likes"][0]["user_id"] == CAROL
        assert again["comments"][0]["content"] == "+1"
        assert again["visible_like_count"] == 1


# --------------------------- TC-11 Stub 契约形状自证（§6 基建）


class TestStubContractShape:
    def test_like_post_idempotent_single_row(self):
        store = StubStore(likes=())

        store.likePost(1, CAROL)
        store.likePost(1, CAROL)

        assert len(store.getLikesByPostIds([1])) == 1

    def test_unlike_post_idempotent(self):
        store = StubStore(likes=())

        store.unlikePost(1, CAROL)  # 未点赞时静默

        assert store.getLikesByPostIds([1]) == []

    def test_create_comment_returns_full_row_with_incrementing_id(self):
        store = StubStore(comments=())

        first = store.createComment(1, CAROL, "+1")
        second = store.createComment(1, ALICE, "路过")

        assert set(first) == {"id", "post_id", "user_id", "content", "created_at"}
        assert second["id"] == first["id"] + 1
        assert len(store.getCommentsByPostIds([1])) == 2

    def test_batch_reads_scoped_and_empty_input(self):
        store = StubStore()

        assert len(store.getLikesByPostIds([1, 1])) == 3  # 入参去重后完备
        assert store.getLikesByPostIds([]) == []
        assert store.getCommentsByPostIds([999]) == []
