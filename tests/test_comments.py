"""FP-002 评论数据表与存取原语 —— 测试套件.

对应 docs/test-cases/FP-002-comments-storage.md（TC-01 ~ TC-07）。
"""

import sqlite3

import pytest

from storage import DataStore

# §种子时间戳：T1 < T2 < T3；TE 与 T3 同时刻（构造 id 升序并列）
T1 = "2026-09-20T08:00:00+00:00"
T2 = "2026-09-20T09:00:00+00:00"
T3 = "2026-09-20T10:00:00+00:00"
TE = "2026-09-20T10:00:00+00:00"

ALICE, BOB, CAROL = 1, 2, 3
P1, P2, P3 = 1, 2, 3  # P1/P2 = bob 的两帖，P3 = carol 的帖（他帖探针）

USERS = ((ALICE, "alice"), (BOB, "bob"), (CAROL, "carol"))
POSTS = (
    (P1, BOB, "b-post-1", T1),
    (P2, BOB, "b-post-2", T1),
    (P3, CAROL, "c-post", T1),
)


@pytest.fixture()
def store(tmp_path):
    """空存储（种子由各测试经 seed() 显式直插），每个测试独立 SQLite 文件."""
    s = DataStore(tmp_path / "social.db")
    yield s
    s.close()


def seed(store, comments=()):
    """§种子直插：alice/bob/carol + 三帖 + 可选评论（created_at 显式指定，时序确定）.

    每测试恰调用一次（fixture 不预置，评论场景由各测试自带）。
    """
    con = sqlite3.connect(store.path)
    try:
        for uid, name in USERS:
            con.execute(
                "INSERT INTO users (id, username, password_hash, salt, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (uid, name, f"h{uid}", f"s{uid}", T1),
            )
        for post_id, author_id, content, created_at in POSTS:
            con.execute(
                "INSERT INTO posts (id, author_id, content, created_at)"
                " VALUES (?, ?, ?, ?)",
                (post_id, author_id, content, created_at),
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


def reopen(store):
    """模拟应用重启：关闭连接后重新打开同一文件."""
    path = store.path
    store.close()
    return DataStore(path)


# ------------------------------------------------ TC-01 comments 表契约（验收 1）


class TestCommentsSchema:
    def test_columns_match_posts_style(self, store):
        rows = store._conn.execute("PRAGMA table_info(comments)").fetchall()
        columns = {row["name"]: row for row in rows}

        assert set(columns) == {"id", "post_id", "user_id", "content", "created_at"}
        assert columns["id"]["pk"] == 1  # 自增主键（INTEGER PRIMARY KEY）
        assert columns["post_id"]["notnull"] == 1
        assert columns["user_id"]["notnull"] == 1
        assert columns["content"]["notnull"] == 1
        assert columns["created_at"]["notnull"] == 1

    def test_id_is_autoincrement(self, store):
        # AUTOINCREMENT：显式插入最大 id 后，下一条不再复用已删 id（rowid 回落）
        sql = store._conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='comments'"
        ).fetchone()[0]
        assert "AUTOINCREMENT" in sql.upper()

    def test_foreign_keys_reference_posts_and_users(self, store):
        fks = store._conn.execute("PRAGMA foreign_key_list(comments)").fetchall()
        pairs = {(fk["table"], fk["from"], fk["to"]) for fk in fks}

        assert ("posts", "post_id", "id") in pairs
        assert ("users", "user_id", "id") in pairs

    def test_named_post_id_index_exists(self, store):
        indexes = store._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='comments'"
        ).fetchall()
        names = {row["name"] for row in indexes}

        assert "idx_comments_post_id" in names  # 命名风格对齐 idx_posts_author_id

    def test_reopen_is_idempotent(self, store):
        seed(store)
        reopened = reopen(store)
        try:
            assert reopened.createComment(P1, ALICE, "still works")
        finally:
            reopened.close()


# ------------------------------------------- TC-02 createComment 写入与读回（验收 2）


class TestCreateComment:
    def test_returns_full_row(self, store):
        seed(store)
        comment = store.createComment(P1, ALICE, "hello")

        assert set(comment) == {"id", "post_id", "user_id", "content", "created_at"}
        assert isinstance(comment["id"], int) and comment["id"] > 0
        assert comment["post_id"] == P1
        assert comment["user_id"] == ALICE
        assert comment["content"] == "hello"
        assert comment["created_at"]

        rows = store.getCommentsByPostIds([P1])
        assert rows == [comment]

    def test_ids_increase_across_creates(self, store):
        seed(store)
        first = store.createComment(P1, ALICE, "one")
        second = store.createComment(P1, BOB, "two")
        third = store.createComment(P2, CAROL, "three")

        assert second["id"] > first["id"] > 0
        assert third["id"] > second["id"]


# --------------------------- TC-03 created_at 正序 + 同时刻 id 升序（验收 3）


class TestOrdering:
    def test_ascending_by_created_at_regardless_of_insert_order(self, store):
        # 直插顺序故意打乱（T3 → T1 → T2），验证读侧排序而非插入顺序
        seed(
            store,
            comments=[
                (P1, BOB, "late", T3),
                (P1, ALICE, "early", T1),
                (P1, CAROL, "middle", T2),
            ],
        )

        rows = store.getCommentsByPostIds([P1])

        assert [row["content"] for row in rows] == ["early", "middle", "late"]

    def test_same_instant_ties_broken_by_id_ascending(self, store):
        # id 较小者先插入且与 id 较大者同时刻 TE；另有一条更早的 T1
        seed(
            store,
            comments=[
                (P1, ALICE, "first", T1),
                (P1, BOB, "tie-low-id", TE),
                (P1, CAROL, "tie-high-id", TE),
            ],
        )

        rows = store.getCommentsByPostIds([P1])

        assert [row["content"] for row in rows] == ["first", "tie-low-id", "tie-high-id"]
        tie_ids = [row["id"] for row in rows[1:]]
        assert tie_ids == sorted(tie_ids)


# ------------------------------ TC-04 同用户同帖多次评论全部保留（验收 4）


class TestRepeatedCommentsKept:
    def test_same_user_same_post_all_retained(self, store):
        seed(store)
        store.createComment(P1, ALICE, "c-1")
        store.createComment(P1, ALICE, "c-2")
        store.createComment(P1, ALICE, "c-3")

        rows = store.getCommentsByPostIds([P1])

        assert [row["content"] for row in rows] == ["c-1", "c-2", "c-3"]
        assert all(row["user_id"] == ALICE for row in rows)
        assert len({row["id"] for row in rows}) == 3  # 三条独立记录


# ------------------------------------------------------ TC-05 集合查询边界


class TestPostIdsEdgeCases:
    def test_empty_input_returns_empty_list(self, store):
        assert store.getCommentsByPostIds([]) == []

    def test_duplicate_input_deduplicated(self, store):
        seed(store, comments=[(P1, ALICE, "only", T1)])

        rows = store.getCommentsByPostIds([P1, P1, P1])

        assert len(rows) == 1
        assert rows[0]["content"] == "only"

    def test_multi_post_aggregation_complete_and_globally_ordered(self, store):
        seed(
            store,
            comments=[
                (P1, ALICE, "p1-late", T3),
                (P1, BOB, "p1-early", T1),
                (P2, CAROL, "p2-middle", T2),
            ],
        )

        rows = store.getCommentsByPostIds([P1, P2])

        assert [row["content"] for row in rows] == ["p1-early", "p2-middle", "p1-late"]
        assert {row["post_id"] for row in rows} == {P1, P2}

    def test_unknown_post_ids_collapse_to_known_subset(self, store):
        seed(store, comments=[(P1, ALICE, "known", T1)])

        rows = store.getCommentsByPostIds([P1, 999, 1000])

        assert len(rows) == 1
        assert (rows[0]["post_id"], rows[0]["user_id"]) == (P1, ALICE)
        assert (rows[0]["content"], rows[0]["created_at"]) == ("known", T1)

    def test_posts_without_comments_return_nothing(self, store):
        assert store.getCommentsByPostIds([P1, P2, P3]) == []


# ------------------------------------- TC-06 存储层不做内容校验（§4）


class TestNoContentValidation:
    def test_over_280_codepoints_stored_verbatim(self, store):
        seed(store)
        content = "长" * 281  # 1–280 规则归上层（FP-016 服务层），本层放行

        comment = store.createComment(P1, ALICE, content)

        assert comment["content"] == content
        assert store.getCommentsByPostIds([P1])[0]["content"] == content

    def test_whitespace_and_unicode_stored_verbatim(self, store):
        seed(store)
        content = "  hi 😄\n再会\t"

        comment = store.createComment(P1, ALICE, content)

        assert comment["content"] == content


# ------------------------------------------------------ TC-07 持久化


class TestPersistenceAcrossRestart:
    def test_comments_survive_restart(self, store):
        seed(store)
        created = store.createComment(P1, ALICE, "durable")

        reopened = reopen(store)
        try:
            assert reopened.getCommentsByPostIds([P1]) == [created]
        finally:
            reopened.close()
