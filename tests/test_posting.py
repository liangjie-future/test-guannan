"""FP-013 发帖内容规则 —— 测试套件.

对应 docs/test-cases/FP-013-post-content-rules.md（TC-01 ~ TC-08）。
"""

from datetime import datetime

import pytest

from services import (
    MAX_POST_LENGTH,
    REASON_AUTHOR_NOT_FOUND,
    REASON_EMPTY_CONTENT,
    REASON_TOO_LONG,
    PostService,
)
from storage import DataStore


class InMemoryContractStore:
    """§3.2 最小契约内存替身（§6 Mock 策略）：仅 getUserById / createPost."""

    def __init__(self):
        self.users = {}
        self.posts = []
        self.create_post_calls = 0

    def addUser(self, username):
        user_id = len(self.users) + 1
        self.users[user_id] = {"id": user_id, "username": username}
        return user_id

    def getUserById(self, id):
        return self.users.get(id)

    def createPost(self, author_id, content):
        self.create_post_calls += 1
        post = {
            "id": self.create_post_calls,
            "author_id": author_id,
            "content": content,
            "created_at": "2026-01-01T00:00:00+00:00",
        }
        self.posts.append(post)
        return post


MISSING_AUTHOR_ID = 999_999


def seed_alice(store):
    """种子作者 alice：新库首条用户，id=1（任务卡 §6）."""
    if isinstance(store, InMemoryContractStore):
        return store.addUser("alice")
    return store.createUser("alice", "hash-alice", "salt-alice")


@pytest.fixture(params=["sqlite", "in-memory"])
def env(request, tmp_path):
    """每例独立环境：(store, service)；覆盖真实存储与契约替身两条路径."""
    if request.param == "sqlite":
        store = DataStore(tmp_path / "social.db")
    else:
        store = InMemoryContractStore()
    yield store, PostService(store)
    if request.param == "sqlite":
        store.close()


# ------------------------------------------------------- TC-01 合法内容发布


class TestValidPost:
    def test_first_post_saves_with_full_association(self, env):
        store, service = env
        alice_id = seed_alice(store)
        assert alice_id == 1

        result = service.createPost(alice_id, "first post!")

        assert result["status"] == "OK"
        post = result["post"]
        assert set(post) == {"id", "author_id", "content", "created_at"}
        assert post["author_id"] == alice_id
        assert post["content"] == "first post!"
        datetime.fromisoformat(post["created_at"])  # 合法时间
        assert posts_of(store, alice_id) == [post]  # 关联完整，可进入时间线

    def test_two_posts_get_distinct_ids(self, env):
        store, service = env
        alice_id = seed_alice(store)
        p1 = service.createPost(alice_id, "one")["post"]
        p2 = service.createPost(alice_id, "two")["post"]
        assert p1["id"] != p2["id"]


# -------------------------------------------------- TC-02 边界与去空白口径


class TestLengthRule:
    def test_exactly_280_chars_is_allowed(self, env):
        store, service = env
        alice_id = seed_alice(store)
        boundary = "字" * 280
        result = service.createPost(alice_id, boundary)
        assert result["status"] == "OK"
        assert result["post"]["content"] == boundary

    def test_281_chars_is_rejected(self, env):
        store, service = env
        alice_id = seed_alice(store)
        result = service.createPost(alice_id, "字" * 281)
        assert result == {"status": "ERROR", "reason": REASON_TOO_LONG}
        assert posts_of(store, alice_id) == []

    def test_length_counts_code_points_after_trim(self, env):
        store, service = env
        alice_id = seed_alice(store)
        mixed = ("🎉汉 a\n\t" * 46) + "abcd"  # 去空白后恰 280 码点
        assert len(mixed.strip()) == MAX_POST_LENGTH
        result = service.createPost(alice_id, f"  {mixed}  ")
        assert result["status"] == "OK"

    def test_surrounding_whitespace_trimmed_before_save(self, env):
        store, service = env
        alice_id = seed_alice(store)
        result = service.createPost(alice_id, "  hello world  \n\t")
        assert result["status"] == "OK"
        assert result["post"]["content"] == "hello world"

    def test_inner_whitespace_preserved_verbatim(self, env):
        store, service = env
        alice_id = seed_alice(store)
        text = "a b\tc\nd  e"
        result = service.createPost(alice_id, text)
        assert result["post"]["content"] == text

    def test_281_whitespace_chars_reports_empty_not_too_long(self, env):
        store, service = env
        alice_id = seed_alice(store)
        result = service.createPost(alice_id, " " * 281)
        assert result == {"status": "ERROR", "reason": REASON_EMPTY_CONTENT}


def posts_of(store, author_id):
    if isinstance(store, InMemoryContractStore):
        return [p for p in store.posts if p["author_id"] == author_id]
    return store.getPostsByAuthorIds({author_id})


# --------------------------------------------------------- TC-03 空内容拒绝


class TestEmptyContent:
    @pytest.mark.parametrize("content", ["", "   ", " \n\t ", "　"])
    def test_empty_or_whitespace_only_rejected(self, env, content):
        store, service = env
        alice_id = seed_alice(store)
        result = service.createPost(alice_id, content)
        assert result == {"status": "ERROR", "reason": REASON_EMPTY_CONTENT}
        assert posts_of(store, alice_id) == []


# ----------------------------------------------------------- TC-05 作者不存在


class TestAuthorNotFound:
    def test_unknown_author_rejected(self, env):
        store, service = env
        seed_alice(store)
        result = service.createPost(MISSING_AUTHOR_ID, "hello")
        assert result == {"status": "ERROR", "reason": REASON_AUTHOR_NOT_FOUND}
        assert posts_of(store, MISSING_AUTHOR_ID) == []

    def test_author_check_takes_priority(self, env):
        """校验顺序：作者存在 → 非空 → 长度（§3.2）."""
        store, service = env
        seed_alice(store)
        for content in ("", " " * 281, "字" * 281):
            result = service.createPost(MISSING_AUTHOR_ID, content)
            assert result == {"status": "ERROR", "reason": REASON_AUTHOR_NOT_FOUND}


# ------------------------------------------------ TC-06 失败后集合不增长


class TestNoSideEffectOnFailure:
    def test_failures_do_not_grow_post_collection(self, env):
        store, service = env
        alice_id = seed_alice(store)
        service.createPost(alice_id, "keep me")
        baseline = len(posts_of(store, alice_id))

        failures = [
            service.createPost(MISSING_AUTHOR_ID, "x"),
            service.createPost(alice_id, ""),
            service.createPost(alice_id, "字" * 281),
        ]
        assert {f["reason"] for f in failures} == {
            REASON_AUTHOR_NOT_FOUND,
            REASON_EMPTY_CONTENT,
            REASON_TOO_LONG,
        }
        assert len(posts_of(store, alice_id)) == baseline
        if isinstance(store, InMemoryContractStore):
            assert store.create_post_calls == 1  # 仅成功路径触达写入


# ------------------------------------- TC-07 结果形状（两条路径一致已由上方覆盖）


class TestResultShape:
    def test_ok_and_error_keys_exclusive(self, env):
        store, service = env
        alice_id = seed_alice(store)
        ok = service.createPost(alice_id, "hi")
        assert set(ok) == {"status", "post"}
        for bad in ("", "字" * 281):
            err = service.createPost(alice_id, bad)
            assert set(err) == {"status", "reason"}


# ---------------------------------------------------- TC-08 非字符串入参


class TestNonStringInput:
    @pytest.mark.parametrize("content", [None, 123, ["a"]])
    def test_non_string_raises_type_error(self, env, content):
        store, service = env
        alice_id = seed_alice(store)
        with pytest.raises(TypeError):
            service.createPost(alice_id, content)
