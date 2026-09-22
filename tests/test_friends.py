"""FP-003 好友与共同好友关系推导原语 —— 测试套件.

对应 docs/test-cases/FP-003-friend-relations.md（TC-01 ~ TC-10）。

规格矛盾裁决（详见 docs/designs/FP-003-friend-relations.md）：按 §4 公式
mutualFriendIds(v, a) = friendIds(v) ∩ friendIds(a)，字面种子上
mutualFriendIds(alice, bob) = {bob} ∩ {alice, carol} = ∅，与任务卡 §7
验收 2 的 {carol} 互斥（其括注「carol 与双方均互关」与验收 1 的「carol
未回关不算好友」直接矛盾）。以公式为准：验收 1/3/4 照字面验证，验收 2
的场景形状以变体种子 S2（补 carol→alice 互关）验证。
"""

import sqlite3

import pytest

from storage import DataStore, SelfFollowError


@pytest.fixture()
def store(tmp_path):
    """真实存储：每个测试独立 SQLite 文件."""
    s = DataStore(tmp_path / "social.db")
    yield s
    s.close()


def seed(store):
    """§6 字面种子：alice / bob / carol + 五条边.

    边：alice→bob、bob→alice（互关）、alice→carol（单向，carol 未回关）、
    bob→carol、carol→bob（互关）——好友(alice)={bob}、好友(bob)={alice, carol}。
    """
    ids = {}
    for i, name in enumerate(("alice", "bob", "carol"), start=1):
        ids[i] = store.createUser(name, f"h{i}", f"s{i}")
    alice, bob, carol = ids[1], ids[2], ids[3]
    for follower, followee in ((alice, bob), (bob, alice), (alice, carol),
                               (bob, carol), (carol, bob)):
        store.addFollow(follower, followee)
    return {"alice": alice, "bob": bob, "carol": carol}


def seed_s2(store):
    """变体种子 S2：字面种子补 carol→alice——carol 与 alice、bob 均互关."""
    ids = seed(store)
    store.addFollow(ids["carol"], ids["alice"])
    return ids


def delete_follow(store, follower_id, followee_id):
    """解除边：独立连接直接 SQL 删除 follows 行（§5 系统无取关原语）."""
    con = sqlite3.connect(store.path)
    try:
        con.execute(
            "DELETE FROM follows WHERE follower_id = ? AND followee_id = ?",
            (follower_id, followee_id),
        )
        con.commit()
    finally:
        con.close()


def bob_carol_edge(direction, ids):
    """bob↔carol 互关边的参数化选取：carol_to_bob / bob_to_carol."""
    return ((ids["carol"], ids["bob"]) if direction == "carol_to_bob"
            else (ids["bob"], ids["carol"]))


def count_follows(store):
    """直接数 follows 表行数，验证「纯读不改边」不走任何接口."""
    con = sqlite3.connect(store.path)
    try:
        return con.execute("SELECT COUNT(*) FROM follows").fetchone()[0]
    finally:
        con.close()


# ------------------------------------- TC-01 friendIds 双向互关判定（验收 1）


class TestFriendIdsBidirectional:
    def test_alice_friends_only_bob_carol_not_following_back(self, store):
        ids = seed(store)
        assert store.friendIds(ids["alice"]) == {ids["bob"]}

    def test_bob_friends_are_alice_and_carol(self, store):
        ids = seed(store)
        assert store.friendIds(ids["bob"]) == {ids["alice"], ids["carol"]}

    def test_carol_friends_only_bob(self, store):
        ids = seed(store)
        assert store.friendIds(ids["carol"]) == {ids["bob"]}

    def test_returns_set_type(self, store):
        ids = seed(store)
        assert isinstance(store.friendIds(ids["alice"]), set)
        assert isinstance(store.mutualFriendIds(ids["alice"], ids["bob"]), set)


# --------------------------- TC-02 mutualFriendIds 交集（验收 2，双轨裁决）


class TestMutualFriendIdsIntersection:
    def test_literal_seed_formula_result_is_empty(self, store):
        """字面种子：公式给出 ∅（记录与 §7 验收 2 字面值的矛盾裁决）."""
        ids = seed(store)
        assert (store.mutualFriendIds(ids["alice"], ids["bob"])
                == store.friendIds(ids["alice"]) & store.friendIds(ids["bob"])
                == set())

    def test_argument_order_symmetric(self, store):
        ids = seed(store)
        assert (store.mutualFriendIds(ids["alice"], ids["bob"])
                == store.mutualFriendIds(ids["bob"], ids["alice"]))

    def test_s2_carol_mutual_with_both_is_the_common_friend(self, store):
        """S2（carol↔alice 补全）：carol 与双方均互关 ⇒ 共同好友 = {carol}."""
        ids = seed_s2(store)
        assert store.mutualFriendIds(ids["alice"], ids["bob"]) == {ids["carol"]}


# --------------------------------- TC-03 边删除实时生效（验收 3，无快照）


class TestEdgeDeletionTakesEffectImmediately:
    @pytest.mark.parametrize("direction", ["carol_to_bob", "bob_to_carol"])
    def test_s2_delete_either_direction_removes_carol_from_mutual(self, store,
                                                                  direction):
        ids = seed_s2(store)

        delete_follow(store, *bob_carol_edge(direction, ids))

        assert ids["carol"] not in store.mutualFriendIds(ids["alice"],
                                                         ids["bob"])
        assert ids["bob"] not in store.friendIds(ids["carol"])
        assert ids["carol"] not in store.friendIds(ids["bob"])

    @pytest.mark.parametrize("direction", ["carol_to_bob", "bob_to_carol"])
    def test_literal_seed_carol_not_in_mutual_after_delete(self, store,
                                                           direction):
        """验收 3 字面：删任一方向边后 carol 不在结果中（此图上本为 ∅）."""
        ids = seed(store)

        delete_follow(store, *bob_carol_edge(direction, ids))

        assert ids["carol"] not in store.mutualFriendIds(ids["alice"],
                                                         ids["bob"])
        assert ids["carol"] not in store.friendIds(ids["bob"])

    def test_deleting_one_way_edge_keeps_results(self, store):
        ids = seed(store)
        delete_follow(store, ids["alice"], ids["carol"])  # 原本就单向，非好友

        assert store.friendIds(ids["alice"]) == {ids["bob"]}
        assert store.mutualFriendIds(ids["alice"], ids["bob"]) == set()


# ------------------------------------------------- TC-04 无共同好友（验收 4）


class TestNoMutualFriends:
    def test_user_without_any_edges_has_no_mutual_friends(self, store):
        ids = seed(store)
        dave = store.createUser("dave", "h4", "s4")

        assert store.mutualFriendIds(ids["alice"], dave) == set()
        assert store.friendIds(dave) == set()

    def test_mutual_between_disconnected_pair_is_empty(self, store):
        dave = store.createUser("dave", "h4", "s4")
        erin = store.createUser("erin", "h5", "s5")
        assert store.mutualFriendIds(dave, erin) == set()


# ------------------------------ TC-05 新增边实时生效（TC-03 的对偶，无缓存）


class TestEdgeAdditionTakesEffectImmediately:
    def test_completing_mutual_follow_updates_results_at_once(self, store):
        ids = seed(store)
        store.addFollow(ids["carol"], ids["alice"])  # 补全 alice↔carol 互关

        assert store.friendIds(ids["alice"]) == {ids["bob"], ids["carol"]}
        mutual = store.mutualFriendIds(ids["alice"], ids["bob"])
        assert mutual == {ids["carol"]}
        assert store.mutualFriendIds(ids["alice"], ids["carol"]) == {ids["bob"]}


# ------------------------------------- TC-06 无快照：重复查询无副作用（纯读）


class TestPureQueryWithoutSideEffects:
    def test_repeated_queries_are_stable_and_follows_untouched(self, store):
        ids = seed(store)
        before = count_follows(store)

        friends = [store.friendIds(ids["alice"]) for _ in range(3)]
        mutuals = [store.mutualFriendIds(ids["alice"], ids["bob"])
                   for _ in range(3)]

        assert all(r == {ids["bob"]} for r in friends)
        assert all(r == set() for r in mutuals)
        assert count_follows(store) == before


# ------------------------------ TC-07 不存在的用户与同参（错误路径 / 坍缩）


class TestMissingUserAndSameArguments:
    def test_missing_user_collapses_to_empty_set(self, store):
        ids = seed(store)
        assert store.friendIds(999) == set()
        assert store.mutualFriendIds(ids["alice"], 999) == set()
        assert store.mutualFriendIds(999, ids["alice"]) == set()
        assert store.mutualFriendIds(999, 999) == set()

    def test_mutual_with_self_equals_own_friends(self, store):
        ids = seed(store)
        assert (store.mutualFriendIds(ids["alice"], ids["alice"])
                == store.friendIds(ids["alice"]))


# --------------------------- TC-08 自关注禁令传导（无人是自己的好友，口径基础）


class TestSelfFollowGuarantee:
    def test_self_follow_still_rejected_and_never_own_friend(self, store):
        ids = seed(store)
        with pytest.raises(SelfFollowError):
            store.addFollow(ids["alice"], ids["alice"])

        for name in ("alice", "bob", "carol"):
            assert ids[name] not in store.friendIds(ids[name])


# --------------------------------------------- TC-09 跨重启持久（FP-001 集成）


class TestPersistenceAcrossRestart:
    def test_derived_relations_survive_restart(self, store):
        ids = seed_s2(store)
        expected_friends = store.friendIds(ids["alice"])
        expected_mutual = store.mutualFriendIds(ids["alice"], ids["bob"])

        path = store.path
        store.close()
        with DataStore(path) as reopened:
            assert reopened.friendIds(ids["alice"]) == expected_friends
            assert (reopened.mutualFriendIds(ids["alice"], ids["bob"])
                    == expected_mutual == {ids["carol"]})


# --------------------------------------- TC-10 返回值为独立副本（边界）


class TestReturnedSetIsIndependentCopy:
    def test_mutating_result_does_not_affect_next_query(self, store):
        ids = seed_s2(store)
        friends = store.friendIds(ids["alice"])
        friends.add(999)  # 原地污染返回集合
        mutual = store.mutualFriendIds(ids["alice"], ids["bob"])
        mutual.discard(ids["carol"])

        assert store.friendIds(ids["alice"]) == {ids["bob"], ids["carol"]}
        assert store.mutualFriendIds(ids["alice"], ids["bob"]) == {ids["carol"]}
