"""FP-007 注册规则与建号 —— 测试套件.

对应 docs/test-cases/FP-007-register-rules.md（TC-01 ~ TC-09）。
"""

import hashlib
import json
import threading
from datetime import datetime

import pytest

from security import verifyPassword
from services import (
    MIN_PASSWORD_LENGTH,
    REASON_PASSWORD_TOO_SHORT,
    REASON_USERNAME_TAKEN,
    RegistrationService,
)
from storage import DataStore, UsernameAlreadyExistsError

WORKERS = 8


def fast_hash(plain_password):
    """快速散列替身（§6 Mock）：确定性摘要、不含明文，仅测试侧使用."""
    salt = "fast-salt"
    digest = hashlib.sha256(f"{salt}:{plain_password}".encode("utf-8")).hexdigest()
    return {"hash": digest, "salt": salt}


class InMemoryContractStore:
    """§3.2 最小契约内存替身（§6 Mock 策略）.

    users Map + 锁保证原子唯一约束（等价 SQLite UNIQUE 兜底）、
    createSession 返回种子 token；listUsers / getUserByUsername 只读。
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._next_id = 0
        self._users = []
        self._next_session = 0

    def createUser(self, username, password_hash, salt):
        with self._lock:
            if any(u["username"] == username for u in self._users):
                raise UsernameAlreadyExistsError("用户名已存在")
            self._next_id += 1
            user = {
                "id": self._next_id,
                "username": username,
                "password_hash": password_hash,
                "salt": salt,
                "created_at": "2026-01-01T00:00:00+00:00",
            }
            self._users.append(user)
            return user["id"]

    def getUserByUsername(self, username):
        with self._lock:
            for user in self._users:
                if user["username"] == username:
                    return dict(user)
            return None

    def listUsers(self):
        with self._lock:
            return [
                {k: user[k] for k in ("id", "username", "created_at")}
                for user in self._users
            ]

    def createSession(self, user_id):
        with self._lock:
            self._next_session += 1
            return {
                "token": f"seed-token-{self._next_session}",
                "expires_at": "2026-01-08T00:00:00+00:00",
            }


def seed_alice(store):
    """种子占用用户名 alice（散列占位记录，任务卡 §6）."""
    return store.createUser("alice", "hash-alice", "salt-alice")


def users_named(store, username):
    """按用户名取账号列表（唯一性断言口径，兼容两种存储）."""
    return [u for u in store.listUsers() if u["username"] == username]


@pytest.fixture(params=["sqlite", "in-memory"])
def env(request, tmp_path):
    """每例独立环境：(store, service, session_calls).

    快速散列替身 + 记录型会话工厂（真实 / 替身存储两条路径）；
    真实 FP-002 散列与默认会话工厂由 TestRealHashIntegration 以裸构造覆盖。
    """
    if request.param == "sqlite":
        store = DataStore(tmp_path / "social.db")
    else:
        store = InMemoryContractStore()
    session_calls = []

    def create_session_on_login(user_id):
        session_calls.append(user_id)
        return f"seed-token-{len(session_calls)}"

    service = RegistrationService(
        store,
        hash_password=fast_hash,
        create_session_on_login=create_session_on_login,
    )
    yield store, service, session_calls
    if request.param == "sqlite":
        store.close()


@pytest.fixture
def sqlite_env(tmp_path):
    """真实存储独占环境：验证默认散列 / 默认会话工厂的生产路径."""
    store = DataStore(tmp_path / "social.db")
    yield store
    store.close()


# --------------------------------------------------- TC-01 成功注册建号


class TestSuccessfulRegistration:
    def test_creates_account_with_full_fields_no_plaintext(self, env):
        store, service, session_calls = env
        result = service.register("newuser", "secret123")

        assert result["status"] == "OK"
        assert set(result) == {"status", "user", "session_token"}
        assert set(result["user"]) == {"id", "username"}
        assert result["user"]["username"] == "newuser"

        row = store.getUserByUsername("newuser")
        assert set(row) == {"id", "username", "password_hash", "salt", "created_at"}
        assert row["id"] == result["user"]["id"]
        datetime.fromisoformat(row["created_at"])  # 合法创建时间
        assert "secret123" not in json.dumps(row)  # 落库无明文
        assert "secret123" not in json.dumps(result)  # 响应无明文

    def test_first_claim_of_seed_name_on_fresh_store(self, env):
        """验收 1 前置：种子中 alice 未占用时，首位提交者成功建号."""
        store, service, session_calls = env
        result = service.register("alice", "secret123")
        assert result["status"] == "OK"
        assert len(users_named(store, "alice")) == 1

    def test_distinct_user_ids_for_distinct_registrations(self, env):
        store, service, session_calls = env
        first = service.register("newuser", "secret123")
        second = service.register("otheruser", "secret123")
        assert first["user"]["id"] != second["user"]["id"]


# ------------------------------------------------ TC-02 建号即进入登录态


class TestLoginStateOnSuccess:
    def test_injected_session_factory_called_with_new_user_id(self, env):
        store, service, session_calls = env
        result = service.register("newuser", "secret123")
        assert session_calls == [result["user"]["id"]]  # 仅建号成功路径建会话
        assert result["session_token"] == "seed-token-1"

    def test_default_session_token_is_usable(self, sqlite_env):
        """默认会话工厂（store.createSession 派生）：凭据真实可读回."""
        store = sqlite_env
        service = RegistrationService(store)
        result = service.register("newuser", "secret123")

        token = result["session_token"]
        assert isinstance(token, str) and token
        session = store.getSession(token)
        assert session is not None
        assert session["user_id"] == result["user"]["id"]

    def test_default_tokens_distinct_across_registrations(self, sqlite_env):
        store = sqlite_env
        service = RegistrationService(store)
        token1 = service.register("newuser", "secret123")["session_token"]
        token2 = service.register("otheruser", "secret123")["session_token"]
        assert token1 != token2


# ------------------------------------------------------ TC-03 用户名已占用


class TestUsernameTaken:
    def test_taken_username_rejected_with_any_password(self, env):
        """验收 2：alice 已存在时配任意密码（含合法长度）→ USERNAME_TAKEN."""
        store, service, session_calls = env
        seed_alice(store)

        for password in ("secret123", "whatever9"):
            assert service.register("alice", password) == {
                "status": "ERROR",
                "reason": REASON_USERNAME_TAKEN,
            }
        assert len(users_named(store, "alice")) == 1  # 不建号
        assert session_calls == []  # 不建会话

    def test_taken_username_takes_priority_over_short_password(self, env):
        """校验顺序（§4）：用户名占用先于密码长度判定."""
        store, service, session_calls = env
        seed_alice(store)
        result = service.register("alice", "12345")
        assert result["reason"] == REASON_USERNAME_TAKEN


# --------------------------------------------------------- TC-04 密码过短


class TestPasswordTooShort:
    def test_short_password_rejected(self, env):
        """验收 3：5 位密码 → PASSWORD_TOO_SHORT，不建号、不建会话、不散列."""
        store, service, session_calls = env
        hash_calls = []

        def counting_hash(plain_password):
            hash_calls.append(plain_password)
            return fast_hash(plain_password)

        counting_service = RegistrationService(
            store,
            hash_password=counting_hash,
            create_session_on_login=lambda user_id: "should-not-happen",
        )
        result = counting_service.register("newuser", "12345")

        assert result == {"status": "ERROR", "reason": REASON_PASSWORD_TOO_SHORT}
        assert users_named(store, "newuser") == []
        assert session_calls == []
        assert hash_calls == []  # 失败路径不触达慢散列

    def test_exactly_six_chars_is_allowed(self, env):
        store, service, session_calls = env
        assert MIN_PASSWORD_LENGTH == 6
        result = service.register("newuser", "123456")
        assert result["status"] == "OK"
        assert len(users_named(store, "newuser")) == 1


# ------------------------------------------------------ TC-05 重复提交幂等


class TestSequentialDuplicateSubmission:
    def test_second_submission_of_same_registration_rejected(self, env):
        """验收 4：同一注册连续提交两次 → 仅一个账号、仅一次会话."""
        store, service, session_calls = env
        first = service.register("newuser", "secret123")
        second = service.register("newuser", "secret123")

        assert first["status"] == "OK"
        assert second == {"status": "ERROR", "reason": REASON_USERNAME_TAKEN}
        assert len(users_named(store, "newuser")) == 1
        assert session_calls == [first["user"]["id"]]


# -------------------------------------------------- TC-06 并发提交唯一性


def run_concurrent_registrations(make_service, workers=WORKERS):
    """并发提交同一注册（barrier 对齐起跑），收集全部结果.

    make_service 每次调用返回 (service, cleanup)：独立存储连接等价并发请求，
    cleanup 在该次提交结束后释放连接。
    """
    barrier = threading.Barrier(workers)
    results = [None] * workers

    def worker(index):
        service, cleanup = make_service()
        barrier.wait()
        try:
            results[index] = service.register("newuser", "secret123")
        finally:
            cleanup()

    threads = [
        threading.Thread(target=worker, args=(index,)) for index in range(workers)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


def assert_exactly_one_account(results, store):
    """并发 / 重复提交口径：恰一个 OK，其余 USERNAME_TAKEN，users 仅一条记录."""
    oks = [r for r in results if r["status"] == "OK"]
    losers = [r for r in results if r["status"] == "ERROR"]
    assert len(oks) + len(losers) == len(results)  # 无异常逃逸
    assert len(oks) == 1
    assert all(
        r == {"status": "ERROR", "reason": REASON_USERNAME_TAKEN} for r in losers
    )
    assert len(users_named(store, "newuser")) == 1  # 唯一约束兜底，无重复账号


class TestConcurrentDuplicateSubmission:
    def test_shared_service_on_in_memory_store(self):
        """验收 4：并发同用户名 → 恰一个 OK，其余 USERNAME_TAKEN，仅一条记录."""
        store = InMemoryContractStore()
        results = run_concurrent_registrations(
            lambda: (
                RegistrationService(
                    store,
                    hash_password=fast_hash,
                    create_session_on_login=lambda user_id: f"tok-{user_id}",
                ),
                lambda: None,
            )
        )
        assert_exactly_one_account(results, store)

    def test_separate_connections_on_shared_sqlite_file(self, tmp_path):
        """真实 SQLite：每线程独立连接（等价并发请求），同库竞争.

        createUser 冲突路径必须回滚未决事务（否则写锁被失败连接持有，
        其余提交方超时报 database is locked 而非 USERNAME_TAKEN）。
        """
        db_path = tmp_path / "social.db"
        DataStore(db_path).close()  # 预建 schema，连接竞争聚焦 INSERT 冲突

        def make_service():
            store = DataStore(db_path)
            service = RegistrationService(
                store,
                hash_password=fast_hash,
                create_session_on_login=lambda user_id: f"tok-{user_id}",
            )
            return service, store.close

        results = run_concurrent_registrations(make_service)
        with DataStore(db_path) as store:
            assert_exactly_one_account(results, store)


# ------------------------------------------- TC-07 结果形状与失败原因语义


class TestResultShape:
    def test_reason_constants_match_contract(self):
        assert (REASON_USERNAME_TAKEN, REASON_PASSWORD_TOO_SHORT) == (
            "USERNAME_TAKEN",
            "PASSWORD_TOO_SHORT",
        )

    def test_ok_and_error_keys_exclusive(self, env):
        store, service, session_calls = env
        ok = service.register("newuser", "secret123")
        assert set(ok) == {"status", "user", "session_token"}
        assert set(ok["user"]) == {"id", "username"}

        seed_alice(store)
        for username, password, reason in (
            ("alice", "secret123", REASON_USERNAME_TAKEN),
            ("otheruser", "12345", REASON_PASSWORD_TOO_SHORT),
        ):
            err = service.register(username, password)
            assert set(err) == {"status", "reason"}
            assert err["reason"] == reason


# --------------------------------------- TC-08 真实散列集成（FP-002 契约）


class TestRealHashIntegration:
    def test_credentials_verify_and_salts_independent(self, env):
        """默认真实 FP-002：同密码两次注册盐 / 散列互异，且可校验往返."""
        store, _fixture_service, _ = env
        service = RegistrationService(store)  # 裸构造：真实散列 + 默认会话工厂

        service.register("newuser", "secret123")
        service.register("otheruser", "secret123")
        u1 = store.getUserByUsername("newuser")
        u2 = store.getUserByUsername("otheruser")

        assert u1["salt"] != u2["salt"]
        assert u1["password_hash"] != u2["password_hash"]
        assert verifyPassword("secret123", u1["salt"], u1["password_hash"])
        assert not verifyPassword("wrongpass", u1["salt"], u1["password_hash"])


# ------------------------------------------------------ TC-09 非字符串入参


class TestNonStringInput:
    @pytest.mark.parametrize(
        "username, password",
        [
            (None, "secret123"),
            (123, "secret123"),
            ("newuser", None),
            ("newuser", 12345),
        ],
    )
    def test_non_string_raises_type_error(self, env, username, password):
        store, service, session_calls = env
        with pytest.raises(TypeError):
            service.register(username, password)
