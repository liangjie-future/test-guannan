"""FP-001 点赞数据表与存取原语 —— 测试套件.

对应 docs/test-cases/FP-001-likes-storage.md（TC-01 ~ TC-08）。
接口断言 + 直查 SQL 双口径，风格对齐 tests/test_follow.py。
"""

import sqlite3
from datetime import datetime

import pytest

from storage import DataStore


@pytest.fixture()
def store(tmp_path):
    """真实 FP-001 存储：每个测试独立 SQLite 文件."""
    s = DataStore(tmp_path / "social.db")
    yield s
    s.close()


def seed(store):
    """§6 种子：alice(id=1) / bob(id=2) / carol(id=3)，P1(bob)、P2(carol).

    新建库自增 id 从 1 起，恰与任务卡种子编号对齐。
    """
    ids = {}
    for i, name in enumerate(("alice", "bob", "carol"), start=1):
        user = store.getUserByUsername(name)
        ids[i] = user["id"] if user else store.createUser(name, f"h{i}", f"s{i}")
    posts = {
        1: store.createPost(ids[2], "P1 by bob")["id"],
        2: store.createPost(ids[3], "P2 by carol")["id"],
    }
    return ids, posts


def raw(store, sql, params=()):
    """绕过任何接口直查库（Row 字典化），验证不走接口的第二口径."""
    con = sqlite3.connect(store.path)
    con.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in con.execute(sql, params).fetchall()]
    finally:
        con.close()


def count_likes(store, post_id=None, user_id=None):
    """直接数 likes 行数（可限定 (post_id, user_id) 一对），验证不走任何接口."""
    if post_id is None:
        return raw(store, "SELECT COUNT(*) FROM likes")[0]["COUNT(*)"]
    return raw(
        store,
        "SELECT COUNT(*) FROM likes WHERE post_id = ? AND user_id = ?",
        (post_id, user_id),
    )[0]["COUNT(*)"]


# ------------------------------------- TC-01 建库即建表（验收 1）


class TestSchemaOnFirstConstruction:
    def test_likes_table_columns_types_and_notnull(self, store):
        cols = {c["name"]: c for c in raw(store, "PRAGMA table_info(likes)")}
        assert set(cols) == {"post_id", "user_id", "created_at"}
        assert cols["post_id"]["type"] == "INTEGER"
        assert cols["user_id"]["type"] == "INTEGER"
        assert cols["created_at"]["type"] == "TEXT"
        assert all(c["notnull"] == 1 for c in cols.values())

    def test_composite_primary_key_on_post_and_user(self, store):
        cols = {c["name"]: c for c in raw(store, "PRAGMA table_info(likes)")}
        assert cols["post_id"]["pk"] == 1  # 复合主键第一列
        assert cols["user_id"]["pk"] == 2  # 复合主键第二列

    def test_duplicate_row_rejected_at_database_level(self, store):
        ids, posts = seed(store)
        con = sqlite3.connect(store.path)
        try:
            con.execute(
                "INSERT INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)",
                (posts[1], ids[1], "2026-01-01T00:00:00+00:00"),
            )
            with pytest.raises(sqlite3.IntegrityError):
                con.execute(
                    "INSERT INTO likes (post_id, user_id, created_at)"
                    " VALUES (?, ?, ?)",
                    (posts[1], ids[1], "2026-01-02T00:00:00+00:00"),
                )
        finally:
            con.close()

    def test_foreign_keys_to_posts_and_users(self, store):
        fks = raw(store, "PRAGMA foreign_key_list(likes)")
        pairs = {(fk["from"], fk["table"], fk["to"]) for fk in fks}
        assert pairs == {("post_id", "posts", "id"), ("user_id", "users", "id")}

    def test_both_indexes_exist_aligned_with_posts_follows_style(self, store):
        names = {idx["name"] for idx in raw(store, "PRAGMA index_list(likes)")}
        assert {"idx_likes_post_id", "idx_likes_user_id"} <= names

    def test_reopen_backfills_missing_index_for_legacy_db(self, store):
        path = store.path
        store.close()
        con = sqlite3.connect(path)  # 模拟缺 idx_likes_user_id 的存量库
        con.execute("DROP INDEX idx_likes_user_id")
        con.commit()
        con.close()
        with DataStore(path) as reopened:
            names = {idx["name"] for idx in raw(reopened, "PRAGMA index_list(likes)")}
        assert "idx_likes_user_id" in names


# ------------------------------------- TC-02 likePost 幂等（验收 2）


class TestLikePostIdempotent:
    def test_double_like_keeps_exactly_one_row(self, store):
        ids, posts = seed(store)

        store.likePost(posts[1], ids[1])
        store.likePost(posts[1], ids[1])  # 重复执行不抛错

        assert count_likes(store) == 1

    def test_triple_like_still_single_row(self, store):
        ids, posts = seed(store)
        for _ in range(3):
            store.likePost(posts[1], ids[1])
        assert count_likes(store) == 1

    def test_distinct_users_each_own_single_row(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])  # alice 赞 P1
        store.likePost(posts[1], ids[2])  # bob 也赞 P1
        store.likePost(posts[1], ids[1])  # alice 重放

        assert count_likes(store) == 2
        keys = {(r["post_id"], r["user_id"]) for r in raw(store, "SELECT * FROM likes")}
        assert keys == {(posts[1], ids[1]), (posts[1], ids[2])}

    def test_created_at_written_iso_utc(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])
        row = raw(store, "SELECT * FROM likes")[0]
        assert datetime.fromisoformat(row["created_at"]).tzinfo is not None


# ------------------------------------- TC-03 unlikePost 删行幂等（验收 3）


class TestUnlikePost:
    def test_unlike_deletes_the_row(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])
        assert count_likes(store) == 1

        store.unlikePost(posts[1], ids[1])

        assert count_likes(store) == 0

    def test_unlike_never_liked_row_no_error(self, store):
        ids, posts = seed(store)
        store.unlikePost(posts[1], ids[1])  # 记录不存在也不报错
        assert count_likes(store) == 0

    def test_double_unlike_idempotent(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])
        store.unlikePost(posts[1], ids[1])
        store.unlikePost(posts[1], ids[1])  # 再次取消不报错
        assert count_likes(store) == 0

    def test_unlike_does_not_disturb_other_likes(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])
        store.likePost(posts[1], ids[2])

        store.unlikePost(posts[1], ids[1])  # 仅删 alice 的行

        assert count_likes(store, posts[1], ids[2]) == 1
        assert count_likes(store, posts[1], ids[1]) == 0


# --------------------------------- TC-04~07 getLikesByPostIds（验收 4）


class TestGetLikesByPostIds:
    def test_returns_all_records_for_both_posts(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])  # P1：alice、bob
        store.likePost(posts[1], ids[2])
        store.likePost(posts[2], ids[3])  # P2：carol

        records = store.getLikesByPostIds([posts[1], posts[2]])

        keys = {(r["post_id"], r["user_id"]) for r in records}
        assert keys == {(posts[1], ids[1]), (posts[1], ids[2]), (posts[2], ids[3])}

    def test_record_shape_fields_complete(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])
        records = store.getLikesByPostIds([posts[1]])
        assert len(records) == 1
        assert set(records[0]) == {"post_id", "user_id", "created_at"}
        assert datetime.fromisoformat(records[0]["created_at"])

    def test_duplicate_input_ids_deduplicated(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])

        records = store.getLikesByPostIds([posts[1], posts[1], posts[1]])

        assert [(r["post_id"], r["user_id"]) for r in records] == [(posts[1], ids[1])]

    def test_empty_input_returns_empty_list(self, store):
        seed(store)
        assert store.getLikesByPostIds([]) == []

    def test_post_without_likes_simply_omitted(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])  # P2 无任何点赞

        records = store.getLikesByPostIds([posts[1], posts[2]])

        assert [(r["post_id"], r["user_id"]) for r in records] == [(posts[1], ids[1])]


# --------------------- TC-08 点赞—取消—再点赞生命周期与跨重启持久


class TestLifecycleAndPersistence:
    def test_like_unlike_relike_exactly_one_row_each_step(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])
        assert count_likes(store) == 1

        store.unlikePost(posts[1], ids[1])
        assert count_likes(store) == 0

        store.likePost(posts[1], ids[1])  # 再点赞：新行恰一条
        store.likePost(posts[1], ids[1])  # 重复仍不复活第二条
        assert count_likes(store) == 1

    def test_likes_survive_restart_and_stay_idempotent(self, store):
        ids, posts = seed(store)
        store.likePost(posts[1], ids[1])
        store.likePost(posts[2], ids[3])

        path = store.path
        store.close()
        with DataStore(path) as reopened:
            keys = {(r["post_id"], r["user_id"]) for r in reopened.getLikesByPostIds([posts[1], posts[2]])}
            assert keys == {(posts[1], ids[1]), (posts[2], ids[3])}
            reopened.likePost(posts[1], ids[1])  # 重启后重复点赞仍幂等
            assert count_likes(reopened) == 2
