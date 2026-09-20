"""FP-015 时间线聚合与排序 —— 测试套件.

对应 docs/test-cases/FP-015-timeline-aggregate-sort.md（TC-01 ~ TC-09）。
"""

import sqlite3

import pytest

from services.timeline import TimelineService
from storage import DataStore

# §6 种子时间戳：t1 < t2 < t3 < t4，B 与 C 交错，倒序结果唯一可断言
T1 = "2026-09-20T08:00:00+00:00"  # B
T2 = "2026-09-20T09:00:00+00:00"  # C
T3 = "2026-09-20T10:00:00+00:00"  # C
T4 = "2026-09-20T11:00:00+00:00"  # B

USERS = (("alice", 1), ("bob", 2), ("carol", 3), ("dave", 4))  # (name, id)


@pytest.fixture()
def store(tmp_path):
    """真实 FP-001 存储：每个测试独立 SQLite 文件."""
    s = DataStore(tmp_path / "social.db")
    yield s
    s.close()


def seed(store, follows=((1, 2), (1, 3)), posts=None):
    """§6 种子：A=1 / B=2 / C=3 / D=4；关注边与帖子可按场景裁剪.

    帖子以显式时间戳直插（created_at 为 TEXT 列），保证交错时间确定。
    """
    con = sqlite3.connect(store.path)
    try:
        for name, uid in USERS:
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
        for author_id, content, created_at in posts or []:
            con.execute(
                "INSERT INTO posts (author_id, content, created_at) VALUES (?, ?, ?)",
                (author_id, content, created_at),
            )
        con.commit()
    finally:
        con.close()
    return {uid: name for name, uid in USERS}


FULL_POSTS = [
    (2, "b-first", T1),
    (3, "c-first", T2),
    (3, "c-second", T3),
    (2, "b-second", T4),
    (1, "a-own", T3),
    (4, "d-unfollowed", T4),
]


def seed_full(store):
    """完整种子：B×2（t1/t4）+ C×2（t2/t3）+ A×1 + D×1."""
    return seed(store, posts=FULL_POSTS)


def timeline_on(store):
    return TimelineService(store)


# ------------------------------------------- TC-01 范围正确性（验收 1）


class TestScope:
    def test_returns_exactly_all_posts_of_b_and_c(self, store):
        seed_full(store)
        entries = timeline_on(store).getTimeline(1)

        assert len(entries) == 4
        assert {e["author_id"] for e in entries} == {2, 3}

    def test_excludes_own_and_unfollowed_posts(self, store):
        seed_full(store)
        entries = timeline_on(store).getTimeline(1)

        contents = [e["content"] for e in entries]
        assert "a-own" not in contents  # 不含 A 自己的帖子
        assert "d-unfollowed" not in contents  # 不含未关注者 D 的帖子

    def test_no_post_of_b_or_c_missing(self, store):
        seed_full(store)
        entries = timeline_on(store).getTimeline(1)

        assert set(e["content"] for e in entries) == {
            "b-first",
            "b-second",
            "c-first",
            "c-second",
        }  # B / C 全部帖子无遗漏

    def test_other_users_timeline_uses_their_own_follow_set(self, store):
        seed(store, follows=((2, 1),), posts=FULL_POSTS)  # 仅 B 关注 A
        entries = timeline_on(store).getTimeline(2)

        assert [e["content"] for e in entries] == ["a-own"]  # B 只见 A 的帖子


# ------------------------------------------- TC-02 倒序正确性（验收 1）


class TestDescendingOrder:
    def test_interleaved_timestamps_sorted_desc(self, store):
        seed_full(store)
        entries = timeline_on(store).getTimeline(1)

        assert [e["content"] for e in entries] == [
            "b-second",  # t4（B）
            "c-second",  # t3（C）
            "c-first",  # t2（C）
            "b-first",  # t1（B）
        ]
        assert [e["created_at"] for e in entries] == [T4, T3, T2, T1]

    def test_created_at_strictly_descending(self, store):
        seed_full(store)
        entries = timeline_on(store).getTimeline(1)

        stamps = [e["created_at"] for e in entries]
        assert all(a > b for a, b in zip(stamps, stamps[1:]))


# ------------------------------------------- TC-03 空态返回空集合（验收 2）


class TestEmptyState:
    def test_no_follows_returns_empty_even_with_own_posts(self, store):
        seed(store, follows=(), posts=FULL_POSTS)  # A 无任何关注边
        assert timeline_on(store).getTimeline(1) == []

    def test_own_posts_never_leak_into_empty_timeline(self, store):
        seed(store, follows=(), posts=[(1, "a-only", T1)])
        assert timeline_on(store).getTimeline(1) == []

    def test_missing_user_returns_empty(self, store):
        seed_full(store)
        assert timeline_on(store).getTimeline(999) == []


# ------------------------------- TC-04 排序按时间瞬间而非字典序（边界）


class TestInstantOrdering:
    def test_timezone_offset_does_not_break_order(self, store):
        # 12:00+02:00 = 10:00 UTC，晚于 T3(10:00 UTC) 但字典序排会在 T4 前
        seed(
            store,
            posts=[
                (2, "b-first", T1),
                (3, "c-only", "2026-09-20T12:00:00+02:00"),
            ],
        )
        entries = timeline_on(store).getTimeline(1)

        assert [e["content"] for e in entries] == ["c-only", "b-first"]

    def test_naive_timestamp_treated_as_utc(self, store):
        seed(
            store,
            posts=[
                (2, "b-aware", T2),  # 09:00 UTC
                (3, "c-naive", "2026-09-20T08:30:00"),  # 视为 08:30 UTC < T2
            ],
        )
        entries = timeline_on(store).getTimeline(1)

        assert [e["content"] for e in entries] == ["b-aware", "c-naive"]


# ------------------------------------------- TC-05 同时刻并列（边界）


class TestSameInstantTies:
    def test_tied_posts_both_present_and_no_crash(self, store):
        seed(
            store,
            posts=[
                (2, "b-tie", T2),
                (3, "c-tie", T2),
                (2, "b-old", T1),
            ],
        )
        entries = timeline_on(store).getTimeline(1)

        assert set(e["content"] for e in entries[:2]) == {"b-tie", "c-tie"}
        assert entries[2]["content"] == "b-old"


# ------------------------------- TC-06 作者信息补全口径（§4 本任务补齐）


class TestAuthorEnrichment:
    def test_entries_carry_author_id_and_username(self, store):
        names = seed_full(store)
        entries = timeline_on(store).getTimeline(1)

        for entry in entries:
            assert entry["author_username"] == names[entry["author_id"]]
        assert {e["author_username"] for e in entries} == {"bob", "carol"}

    def test_post_fields_intact(self, store):
        seed_full(store)
        entry = timeline_on(store).getTimeline(1)[0]

        assert set(entry) == {
            "id",
            "author_id",
            "content",
            "created_at",
            "author_username",
        }

    def test_returned_entries_are_copies(self, store):
        seed_full(store)
        svc = timeline_on(store)

        first = svc.getTimeline(1)[0]
        first["content"] = "mutated"
        first["author_username"] = "hacker"

        again = svc.getTimeline(1)
        assert all(e["content"] != "mutated" for e in again)
        assert all(e["author_username"] != "hacker" for e in again)


# --------------------------- TC-07 存储顺序无关（§3.2 顺序不保证）


class ShuffledInMemoryStore:
    """内存契约替身：getPostsByAuthorIds 以逆时间序返回（顺序不保证）."""

    def __init__(self, users, posts, follows):
        self._users = {uid: {"id": uid, "username": name} for uid, name in users}
        self._posts = list(posts)
        self._follows = set(follows)

    def getFolloweeIds(self, user_id):
        return [followee for (follower, followee) in self._follows if follower == user_id]

    def getPostsByAuthorIds(self, author_ids):
        matched = [p for p in self._posts if p["author_id"] in set(author_ids)]
        return sorted(matched, key=lambda p: p["created_at"])  # 升序——最不利输入

    def getUserById(self, id):
        user = self._users.get(id)
        return dict(user) if user else None  # 副本：与 DataStore 行为一致


class TestStorageOrderIndependence:
    def test_output_descending_regardless_of_storage_order(self):
        store = ShuffledInMemoryStore(
            users=((1, "alice"), (2, "bob"), (3, "carol")),
            posts=[
                {"id": 1, "author_id": 2, "content": "b-first", "created_at": T1},
                {"id": 2, "author_id": 3, "content": "c-first", "created_at": T2},
                {"id": 3, "author_id": 3, "content": "c-second", "created_at": T3},
                {"id": 4, "author_id": 2, "content": "b-second", "created_at": T4},
            ],
            follows={(1, 2), (1, 3)},
        )
        entries = TimelineService(store).getTimeline(1)

        assert [e["content"] for e in entries] == [
            "b-second",
            "c-second",
            "c-first",
            "b-first",
        ]


# --------------------------- TC-08 关注变化即时反映（FP-011 联调面）


class TestFollowSetDrivesScope:
    def test_new_follow_immediately_includes_posts(self, store):
        seed_full(store)
        store.addFollow(1, 4)  # A 新关注 D

        entries = timeline_on(store).getTimeline(1)

        assert len(entries) == 5
        assert {e["content"] for e in entries[:2]} == {"b-second", "d-unfollowed"}
        assert [e["created_at"] for e in entries] == sorted(
            (T4, T4, T3, T2, T1), reverse=True
        )

    def test_unfollowed_edge_variant_excludes_author(self, store):
        # 重建变体：仅 A→C，B 的帖子应被排除
        seed(store, follows=((1, 3),), posts=FULL_POSTS)
        entries = timeline_on(store).getTimeline(1)

        assert [e["content"] for e in entries] == ["c-second", "c-first"]

    def test_follow_back_edge_keeps_own_posts_out(self, store):
        # 关注集合含 A→B 与 B→A：B 的时间线含 A 帖，A 的时间线仍不含 A 帖
        seed(store, follows=((1, 2), (2, 1)), posts=FULL_POSTS)
        entries = timeline_on(store).getTimeline(1)

        assert {e["author_id"] for e in entries} == {2}


# --------------------------- TC-09 内存契约替身路径（§6 Mock）


class InMemoryContractStore:
    """§6：内存模拟——users 字典 + posts 列表 + follows 集合，仅 §3.2 三方法."""

    def __init__(self):
        self.users = {}
        self.posts = []
        self.follows = set()
        self._next_id = 1

    def addUser(self, username):
        uid = self._next_id
        self._next_id += 1
        self.users[uid] = {"id": uid, "username": username}
        return uid

    def addPost(self, author_id, content, created_at):
        post = {
            "id": self._next_id,
            "author_id": author_id,
            "content": content,
            "created_at": created_at,
        }
        self._next_id += 1
        self.posts.append(post)
        return post

    def getFolloweeIds(self, user_id):
        return [f for (follower, f) in self.follows if follower == user_id]

    def getPostsByAuthorIds(self, author_ids):
        return [dict(p) for p in self.posts if p["author_id"] in set(author_ids)]

    def getUserById(self, id):
        user = self.users.get(id)
        return dict(user) if user else None


def mock_full():
    store = InMemoryContractStore()
    for name in ("alice", "bob", "carol", "dave"):
        store.addUser(name)  # id 1/2/3/4，与任务卡种子编号对齐
    store.follows = {(1, 2), (1, 3)}
    store.addPost(2, "b-first", T1)
    store.addPost(3, "c-first", T2)
    store.addPost(3, "c-second", T3)
    store.addPost(2, "b-second", T4)
    store.addPost(1, "a-own", T3)
    store.addPost(4, "d-unfollowed", T4)
    return store


class TestInMemoryMockPath:
    def test_scope_and_order_against_mock(self):
        entries = TimelineService(mock_full()).getTimeline(1)

        assert [e["content"] for e in entries] == [
            "b-second",
            "c-second",
            "c-first",
            "b-first",
        ]

    def test_empty_state_against_mock(self):
        store = mock_full()
        store.follows = set()  # A 无任何关注边
        assert TimelineService(store).getTimeline(1) == []

    def test_author_enrichment_against_mock(self):
        entries = TimelineService(mock_full()).getTimeline(1)

        assert [e["author_username"] for e in entries] == [
            "bob",
            "carol",
            "carol",
            "bob",
        ]

    def test_missing_author_username_is_none_not_crash(self):
        store = mock_full()
        del store.users[2]  # 防御口径：作者缺失不崩溃

        entries = TimelineService(store).getTimeline(1)

        assert entries[0]["author_username"] is None  # b-second（作者 B 已缺失）

    def test_self_edge_in_mock_cannot_leak_own_posts(self):
        store = mock_full()
        store.follows.add((1, 1))  # 防御：替身允许自关注边存在

        entries = TimelineService(store).getTimeline(1)

        assert "a-own" not in [e["content"] for e in entries]  # 自己的帖子仍被排除
