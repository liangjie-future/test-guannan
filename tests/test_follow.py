"""FP-011 关注关系规则 —— 测试套件.

对应 docs/test-cases/FP-011-follow-rules.md（TC-01 ~ TC-11）。
"""

import sqlite3

import pytest

from services.follow import (
    FollowError,
    FolloweeNotFoundError,
    FollowService,
    SelfFollowNotAllowedError,
)
from storage import DataStore


@pytest.fixture()
def store(tmp_path):
    """真实 FP-001 存储：每个测试独立 SQLite 文件."""
    s = DataStore(tmp_path / "social.db")
    yield s
    s.close()


def seed_abc(store):
    """§6 种子：用户 A(id=1)、B(id=2)、C(id=3) + 种子边 A→B.

    新建库自增 id 从 1 起，恰与任务卡种子编号对齐。
    """
    ids = {}
    for i, name in enumerate(("alice", "bob", "carol"), start=1):
        user = store.getUserByUsername(name)
        ids[i] = user["id"] if user else store.createUser(name, f"h{i}", f"s{i}")
    store.addFollow(ids[1], ids[2])
    return ids


def count_follows(store):
    """直接数 follows 表行数，验证「仍为一条边」不走任何接口."""
    con = sqlite3.connect(store.path)
    try:
        return con.execute("SELECT COUNT(*) FROM follows").fetchone()[0]
    finally:
        con.close()


def service_on(store):
    return FollowService(store), seed_abc(store)


# ------------------------------------------------- TC-01 建立单向关注（验收 1）


class TestCreateSingleDirectionFollow:
    def test_follow_creates_exactly_one_edge_a_to_b(self, store):
        svc, ids = service_on(store)
        svc.follow(ids[3], ids[2])  # C 关注 B（种子边是 A→B，另取一对）

        assert store.followExists(ids[3], ids[2]) is True
        assert count_follows(store) == 2  # 种子 A→B + 新边 C→B

    def test_follow_is_one_way_no_reverse_edge_no_confirmation(self, store):
        svc, ids = service_on(store)
        a, b = ids[1], ids[3]  # A 尚未关注 C
        svc.follow(a, b)

        assert store.followExists(b, a) is False  # 无 B→A 边
        assert svc.getFollowees(b) == []  # B 不因此关注 A
        # 无需 B 确认：即时生效（种子边 A→B + 新边 A→C）
        assert set(svc.getFollowees(a)) == {ids[2], b}


# ------------------------------------------------- TC-02 重复关注幂等（验收 2）


class TestIdempotentFollow:
    def test_refollow_seed_edge_keeps_single_edge(self, store):
        svc, ids = service_on(store)
        assert count_follows(store) == 1  # 种子边 A→B

        svc.follow(ids[1], ids[2])  # 再次关注

        assert count_follows(store) == 1  # 仍为一条边
        assert svc.getFollowees(ids[1]) == [ids[2]]

    def test_triple_follow_still_single_edge(self, store):
        svc, ids = service_on(store)
        for _ in range(3):
            svc.follow(ids[1], ids[2])
        assert count_follows(store) == 1

    def test_refollow_does_not_disturb_other_edges(self, store):
        svc, ids = service_on(store)
        svc.follow(ids[1], ids[3])
        svc.follow(ids[1], ids[2])  # 幂等重放种子边

        assert set(svc.getFollowees(ids[1])) == {ids[2], ids[3]}
        assert count_follows(store) == 2


# ------------------------------------------------- TC-03 禁止自关注（验收 3）


class TestSelfFollowForbidden:
    def test_follow_self_raises_and_writes_nothing(self, store):
        svc, ids = service_on(store)
        before = count_follows(store)

        with pytest.raises(SelfFollowNotAllowedError, match="不可关注自己"):
            svc.follow(ids[1], ids[1])

        assert store.followExists(ids[1], ids[1]) is False
        assert count_follows(store) == before

    def test_self_follow_error_for_every_existing_user(self, store):
        svc, ids = service_on(store)
        for uid in ids.values():
            with pytest.raises(SelfFollowNotAllowedError):
                svc.follow(uid, uid)
        assert count_follows(store) == 1  # 仅种子边


# ------------------------------------- TC-04 自关注判断优先于存在性（边界）


class TestCheckOrder:
    def test_self_follow_on_missing_user_reports_self_follow(self, store):
        svc, _ = service_on(store)
        with pytest.raises(SelfFollowNotAllowedError, match="不可关注自己"):
            svc.follow(999, 999)  # 而非 FolloweeNotFoundError


# --------------------------------------------- TC-05 关注不存在的用户


class TestFolloweeNotFound:
    def test_follow_missing_user_raises_and_writes_nothing(self, store):
        svc, ids = service_on(store)
        before = count_follows(store)

        with pytest.raises(FolloweeNotFoundError, match="用户不存在"):
            svc.follow(ids[1], 999)

        assert store.followExists(ids[1], 999) is False
        assert count_follows(store) == before

    def test_missing_followee_error_message_exact(self, store):
        svc, ids = service_on(store)
        with pytest.raises(FolloweeNotFoundError) as exc_info:
            svc.follow(ids[1], 999)
        assert str(exc_info.value) == "用户不存在"


# ------------------------------------------------- TC-06 getFollowees 查询


class TestGetFollowees:
    def test_multiple_followees(self, store):
        svc, ids = service_on(store)
        svc.follow(ids[1], ids[3])
        assert set(svc.getFollowees(ids[1])) == {ids[2], ids[3]}

    def test_no_followees_returns_empty(self, store):
        svc, ids = service_on(store)
        assert svc.getFollowees(ids[3]) == []

    def test_followees_consistent_with_follow_exists(self, store):
        svc, ids = service_on(store)
        svc.follow(ids[3], ids[1])
        followees = svc.getFollowees(ids[3])
        assert ids[1] in followees
        assert store.followExists(ids[3], ids[1]) is True
        for uid in (ids[2], ids[3]):
            assert uid not in followees


# ------------------------------- TC-07 单向性不产生任何反向副作用


class TestNoReverseSideEffects:
    def test_followee_side_untouched_and_can_follow_others(self, store):
        svc, ids = service_on(store)
        a, b, c = ids[1], ids[2], ids[3]
        svc.follow(a, c)

        assert svc.getFollowees(b) == []  # 被 A 关注不给 B 带来任何边
        svc.follow(b, c)  # B 独立关注 C
        assert store.followExists(b, c) is True
        assert store.followExists(c, b) is False
        assert set(svc.getFollowees(a)) == {b, c}


# ----------------------------------------------- TC-08 多关注者互不影响


class TestIndependentFollowers:
    def test_two_followers_of_same_followee(self, store):
        svc, ids = service_on(store)
        svc.follow(ids[1], ids[3])
        svc.follow(ids[2], ids[3])

        assert store.followExists(ids[1], ids[3]) is True
        assert store.followExists(ids[2], ids[3]) is True
        assert svc.getFollowees(ids[3]) == []

    def test_idempotent_replay_does_not_disturb_other_follower(self, store):
        svc, ids = service_on(store)
        svc.follow(ids[2], ids[3])
        svc.follow(ids[1], ids[2])  # 幂等重放
        svc.follow(ids[1], ids[2])

        assert store.followExists(ids[2], ids[3]) is True
        assert count_follows(store) == 2


# ----------------------------------------------- TC-09 错误类型语义


class TestErrorTaxonomy:
    def test_both_rules_are_follow_error_subclasses(self):
        assert issubclass(SelfFollowNotAllowedError, FollowError)
        assert issubclass(FolloweeNotFoundError, FollowError)
        assert not issubclass(SelfFollowNotAllowedError, FolloweeNotFoundError)
        assert not issubclass(FolloweeNotFoundError, SelfFollowNotAllowedError)

    def test_catch_via_base_class(self, store):
        svc, ids = service_on(store)
        for follower, followee in ((ids[1], ids[1]), (ids[1], 999)):
            with pytest.raises(FollowError):
                svc.follow(follower, followee)


# ------------------------------------------- TC-10 跨重启持久（FP-001 集成）


class TestPersistenceAcrossRestart:
    def test_follow_survives_restart_and_stays_idempotent(self, store):
        svc, ids = service_on(store)
        svc.follow(ids[1], ids[3])

        path = store.path
        store.close()
        with DataStore(path) as store2:
            svc2 = FollowService(store2)
            assert store2.followExists(ids[1], ids[3]) is True
            assert set(svc2.getFollowees(ids[1])) == {ids[2], ids[3]}
            svc2.follow(ids[1], ids[3])  # 重启后重复关注仍幂等
            assert count_follows(store2) == 2


# --------------------------------- TC-11 内存契约替身路径（§6 Mock）


class InMemoryContractStore:
    """§6：FP-001 未合入时的内存模拟——follows 集合（含唯一性）+ users 存在性."""

    def __init__(self, user_ids):
        self.users = {uid: {"id": uid} for uid in user_ids}
        self.follows = set()

    def getUserById(self, id):
        return self.users.get(id)

    def followExists(self, follower_id, followee_id):
        return (follower_id, followee_id) in self.follows

    def addFollow(self, follower_id, followee_id):
        self.follows.add((follower_id, followee_id))  # set 天然幂等 + 唯一

    def getFolloweeIds(self, user_id):
        return [followee for (follower, followee) in self.follows if follower == user_id]


class TestInMemoryMockPath:
    """同一套核心规则断言在内存替身上重放：服务仅依赖 §3.2 契约形状."""

    def test_full_rule_set_against_mock(self):
        store = InMemoryContractStore(user_ids=[1, 2, 3])
        store.addFollow(1, 2)  # 种子边 A→B
        svc = FollowService(store)

        svc.follow(1, 2)  # 幂等
        assert store.follows == {(1, 2)}

        svc.follow(1, 3)
        assert set(svc.getFollowees(1)) == {2, 3}
        assert store.followExists(3, 1) is False  # 单向，无反向

        with pytest.raises(SelfFollowNotAllowedError, match="不可关注自己"):
            svc.follow(2, 2)
        with pytest.raises(FolloweeNotFoundError, match="用户不存在"):
            svc.follow(2, 999)
        assert store.follows == {(1, 2), (1, 3)}  # 两次拒绝均未产生边
