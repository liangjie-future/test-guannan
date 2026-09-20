"""FP-001 核心数据模型与存储 —— 测试套件.

对应 docs/test-cases/FP-001-core-data-storage.md（TC-01 ~ TC-09）。
"""

import subprocess
import sys
from datetime import timedelta

import pytest

from storage import (
    DataStore,
    SelfFollowError,
    UsernameAlreadyExistsError,
)
from storage.seed import load_seed


@pytest.fixture()
def store(tmp_path):
    """空存储：每个测试独立 SQLite 文件。"""
    s = DataStore(tmp_path / "social.db")
    yield s
    s.close()


def reopen(store):
    """模拟应用重启：关闭连接后重新打开同一文件。"""
    path = store.path
    store.close()
    return DataStore(path)


def make_user(store, username="alice"):
    return store.createUser(username, f"hash-{username}", f"salt-{username}")


# ---------------------------------------------------------------- TC-01 持久化


class TestPersistenceAcrossRestart:
    def test_user_post_follow_session_survive_restart(self, store):
        user_id = make_user(store)
        author_id = make_user(store, "bob")
        post = store.createPost(author_id, "hello world")
        store.addFollow(user_id, author_id)
        session = store.createSession(user_id)

        store = reopen(store)

        user = store.getUserByUsername("alice")
        assert set(user) == {"id", "username", "password_hash", "salt", "created_at"}
        assert user["id"] == user_id
        assert user["username"] == "alice"
        assert user["password_hash"] == "hash-alice"
        assert user["salt"] == "salt-alice"
        assert user["created_at"]

        assert store.getUserById(user_id) == user

        posts = store.getPostsByAuthorIds({author_id})
        assert posts == [post]

        assert store.followExists(user_id, author_id) is True
        assert store.getFolloweeIds(user_id) == [author_id]

        got = store.getSession(session["token"])
        assert got is not None
        assert got["user_id"] == user_id
        assert got["expires_at"] == session["expires_at"]


# ------------------------------------------- TC-02 / TC-02a 作者集合聚合查询


class TestGetPostsByAuthorIds:
    def test_seed_bob_and_carol_yield_all_four_posts(self, store):
        load_seed(store)
        bob = store.getUserByUsername("bob")
        carol = store.getUserByUsername("carol")

        posts = store.getPostsByAuthorIds({bob["id"], carol["id"]})

        assert len(posts) == 4
        assert {p["author_id"] for p in posts} == {bob["id"], carol["id"]}
        assert len({p["id"] for p in posts}) == 4
        for p in posts:
            assert set(p) == {"id", "author_id", "content", "created_at"}
            assert p["content"]
            assert p["created_at"]

    def test_empty_author_set_returns_empty(self, store):
        assert store.getPostsByAuthorIds(set()) == []

    def test_author_without_posts_returns_empty(self, store):
        uid = make_user(store)
        assert store.getPostsByAuthorIds({uid}) == []

    def test_duplicate_author_ids_do_not_duplicate_posts(self, store):
        uid = make_user(store)
        store.createPost(uid, "only once")
        posts = store.getPostsByAuthorIds([uid, uid, uid])
        assert len(posts) == 1

    def test_mixed_existing_and_missing_authors(self, store):
        uid = make_user(store)
        p1 = store.createPost(uid, "a")
        p2 = store.createPost(uid, "b")
        posts = store.getPostsByAuthorIds({uid, 999_999})
        assert sorted(p["id"] for p in posts) == sorted([p1["id"], p2["id"]])


# ------------------------------------------------------------ TC-03 用户名唯一


class TestUsernameUniqueness:
    def test_duplicate_username_raises_conflict(self, store):
        first_id = make_user(store, "alice")
        with pytest.raises(UsernameAlreadyExistsError, match="用户名已存在"):
            store.createUser("alice", "other-hash", "other-salt")

        user = store.getUserByUsername("alice")
        assert user["id"] == first_id
        assert user["password_hash"] == "hash-alice"

    def test_no_duplicate_accounts_after_conflict(self, store):
        make_user(store, "alice")
        make_user(store, "bob")
        with pytest.raises(UsernameAlreadyExistsError):
            store.createUser("alice", "x", "y")
        usernames = [u["username"] for u in store.listUsers()]
        assert sorted(usernames) == ["alice", "bob"]

    def test_conflict_survives_restart(self, store):
        make_user(store, "alice")
        store = reopen(store)
        with pytest.raises(UsernameAlreadyExistsError):
            store.createUser("alice", "x", "y")


# ------------------------------------------------------------ TC-04 用户读取


class TestUserReads:
    def test_get_user_by_username_missing_returns_none(self, store):
        assert store.getUserByUsername("nobody") is None

    def test_get_user_by_id_missing_returns_none(self, store):
        assert store.getUserById(424_242) is None

    def test_by_id_matches_by_username(self, store):
        make_user(store, "alice")
        by_name = store.getUserByUsername("alice")
        assert store.getUserById(by_name["id"]) == by_name

    def test_list_users_shape_and_completeness(self, store):
        for name in ("alice", "bob", "carol"):
            make_user(store, name)
        users = store.listUsers()
        assert sorted(u["username"] for u in users) == ["alice", "bob", "carol"]
        for u in users:
            assert set(u) == {"id", "username", "created_at"}


# ---------------------------------------------------------------- TC-05 会话


class TestSessions:
    def test_unknown_token_returns_none(self, store):
        assert store.getSession("no-such-token") is None

    def test_destroyed_token_returns_none(self, store):
        uid = make_user(store)
        token = store.createSession(uid)["token"]
        store.destroySession(token)
        assert store.getSession(token) is None

    def test_destroy_missing_token_is_idempotent(self, store):
        store.destroySession("no-such-token")

    def test_expired_token_returns_none(self, store):
        uid = make_user(store)
        session = store.createSession(uid, ttl=timedelta(seconds=-1))
        assert store.getSession(session["token"]) is None

    def test_expired_row_cleaned_up(self, store):
        uid = make_user(store)
        session = store.createSession(uid, ttl=timedelta(seconds=-1))
        store.getSession(session["token"])
        store.getSession(session["token"])

    def test_valid_session_roundtrip(self, store):
        uid = make_user(store)
        session = store.createSession(uid)
        assert set(session) == {"token", "expires_at"}
        got = store.getSession(session["token"])
        assert got == {"user_id": uid, "expires_at": session["expires_at"]}

    def test_tokens_are_unique_and_unpredictable(self, store):
        uid = make_user(store)
        tokens = {store.createSession(uid)["token"] for _ in range(20)}
        assert len(tokens) == 20
        assert all(len(t) >= 32 for t in tokens)

    def test_default_ttl_in_future(self, store):
        uid = make_user(store)
        session = store.createSession(uid)
        got = store.getSession(session["token"])
        assert got is not None


# ------------------------------------------------------- TC-06 关注：幂等与查询


class TestFollows:
    def test_add_follow_idempotent(self, store):
        a = make_user(store, "alice")
        b = make_user(store, "bob")
        store.addFollow(a, b)
        store.addFollow(a, b)
        assert store.followExists(a, b) is True
        assert store.getFolloweeIds(a) == [b]

    def test_follow_exists_false_when_absent_or_reversed(self, store):
        a = make_user(store, "alice")
        b = make_user(store, "bob")
        assert store.followExists(a, b) is False
        store.addFollow(b, a)
        assert store.followExists(a, b) is False
        assert store.followExists(b, a) is True

    def test_get_followee_ids_multiple_and_empty(self, store):
        a = make_user(store, "alice")
        b = make_user(store, "bob")
        c = make_user(store, "carol")
        store.addFollow(a, b)
        store.addFollow(a, c)
        assert sorted(store.getFolloweeIds(a)) == [b, c]
        assert store.getFolloweeIds(b) == []

    def test_self_follow_forbidden(self, store):
        a = make_user(store, "alice")
        with pytest.raises(SelfFollowError):
            store.addFollow(a, a)
        assert store.followExists(a, a) is False

    def test_follows_survive_restart(self, store):
        a = make_user(store, "alice")
        b = make_user(store, "bob")
        store.addFollow(a, b)
        store = reopen(store)
        assert store.followExists(a, b) is True


# ------------------------------------------------------------ TC-07 帖子语义


class TestPosts:
    def test_create_post_returns_full_object(self, store):
        uid = make_user(store)
        p1 = store.createPost(uid, "first post")
        p2 = store.createPost(uid, "second post")
        for p, content in ((p1, "first post"), (p2, "second post")):
            assert set(p) == {"id", "author_id", "content", "created_at"}
            assert p["author_id"] == uid
            assert p["content"] == content
            assert p["created_at"]
        assert p1["id"] != p2["id"]

    def test_content_length_not_limited_here(self, store):
        uid = make_user(store)
        long_text = "字" * 500
        p = store.createPost(uid, long_text)
        assert store.getPostsByAuthorIds({uid})[0]["content"] == long_text

    def test_content_preserved_verbatim(self, store):
        uid = make_user(store)
        weird = "  空白\n换行\temoji🎉 — '引号' \"双引号\" </script> "
        p = store.createPost(uid, weird)
        assert store.getPostsByAuthorIds({uid})[0]["content"] == weird


# --------------------------------------------------------- TC-08 schema 契约


class TestSchemaContract:
    def test_reopen_same_file_keeps_data_and_is_idempotent(self, store):
        uid = make_user(store)
        store.createPost(uid, "kept")
        store = reopen(store)
        store.createPost(uid, "added")
        assert len(store.getPostsByAuthorIds({uid})) == 2

    def test_unique_and_index_constraints_exist(self, store):
        import sqlite3

        con = sqlite3.connect(store.path)
        try:
            indexes = {
                row[0]
                for row in con.execute("SELECT name FROM sqlite_master WHERE type='index'")
            }
            tables = {
                row[0]
                for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
        finally:
            con.close()

        assert {"users", "posts", "follows", "sessions"} <= tables
        expected_indexes = {
            "sqlite_autoindex_users_1",  # users.username UNIQUE
            "idx_posts_author_id",
            "idx_posts_created_at",
            "idx_follows_follower_id",
            "idx_follows_followee_id",
            "sqlite_autoindex_follows_1",  # PK(follower_id, followee_id) 唯一
        }
        assert expected_indexes <= indexes


# ------------------------------------------------------------ TC-09 种子数据


class TestSeed:
    def test_load_seed_contents(self, store):
        load_seed(store)
        alice = store.getUserByUsername("alice")
        bob = store.getUserByUsername("bob")
        carol = store.getUserByUsername("carol")
        for u in (alice, bob, carol):
            assert u and u["password_hash"] and u["salt"] and u["created_at"]

        posts = store.getPostsByAuthorIds({bob["id"], carol["id"]})
        assert len(posts) == 4
        assert len(store.getPostsByAuthorIds({alice["id"]})) == 0

        assert sorted(store.getFolloweeIds(alice["id"])) == sorted(
            [bob["id"], carol["id"]]
        )

        session = store.getSession("seed-token-1")
        assert session is not None
        assert session["user_id"] == alice["id"]

    def test_load_seed_idempotent(self, store):
        load_seed(store)
        load_seed(store)
        users = [u["username"] for u in store.listUsers()]
        assert sorted(users) == ["alice", "bob", "carol"]
        bob = store.getUserByUsername("bob")
        carol = store.getUserByUsername("carol")
        assert len(store.getPostsByAuthorIds({bob["id"], carol["id"]})) == 4

    def test_seed_cli(self, tmp_path):
        db = tmp_path / "seeded.db"
        result = subprocess.run(
            [sys.executable, "-m", "storage.seed", str(db)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        s = DataStore(db)
        try:
            assert s.getUserByUsername("alice") is not None
            assert s.getSession("seed-token-1") is not None
        finally:
            s.close()
