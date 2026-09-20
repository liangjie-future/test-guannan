"""FP-009 登录校验 —— 测试套件.

对应 docs/test-cases/FP-009-login-verify.md（TC-01 ~ TC-13）。
"""

import sqlite3

import pytest

from security import hashPassword, verifyPassword
from services.login import LOGIN_ERROR_MESSAGE, LoginService
from storage import DataStore

BOB = "bob"
GHOST = "ghost"
RIGHT_PASSWORD = "right-password"
WRONG_PASSWORD = "wrong-password"

UNIFIED_ERROR = {"status": "ERROR", "message": LOGIN_ERROR_MESSAGE}


@pytest.fixture()
def store(tmp_path):
    """真实 FP-001 存储：每个测试独立 SQLite 文件（已合入，无 Mock）."""
    s = DataStore(tmp_path / "social.db")
    yield s
    s.close()


def seed_bob(store):
    """§6 种子：bob / 明文 right-password（散列+盐入库，明文不入库）."""
    user = store.getUserByUsername(BOB)
    if user is None:
        creds = hashPassword(RIGHT_PASSWORD)
        store.createUser(BOB, creds["hash"], creds["salt"])
        user = store.getUserByUsername(BOB)
    return user


def register(store, username, plain):
    """模拟注册建号（FP-007 侧动作）：散列入库，返回用户记录."""
    creds = hashPassword(plain)
    store.createUser(username, creds["hash"], creds["salt"])
    return store.getUserByUsername(username)


def count_sessions(store):
    """直接数 sessions 表行数，验证会话集合是否增长（不走任何接口）."""
    con = sqlite3.connect(store.path)
    try:
        return con.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    finally:
        con.close()


class VerifySpy:
    """verify_password 替身：计数入参并委托真实 FP-002 校验."""

    def __init__(self):
        self.calls = []

    def __call__(self, plain, salt, stored_hash):
        self.calls.append((plain, salt, stored_hash))
        return verifyPassword(plain, salt, stored_hash)


class SessionSpy:
    """create_session_on_login 替身：计数入参并委托真实建会话（dict 形态）."""

    def __init__(self, store):
        self.store = store
        self.calls = []

    def __call__(self, user_id):
        self.calls.append(user_id)
        return self.store.createSession(user_id)


# ------------------------------------------------ TC-01~04 正确凭证成功（验收 1）


class TestLoginSuccess:
    def test_right_credentials_return_ok_user_and_token(self, store):
        bob = seed_bob(store)
        result = LoginService(store).login(BOB, RIGHT_PASSWORD)
        assert result["status"] == "OK"
        assert result["user"] == {"id": bob["id"], "username": BOB}
        assert isinstance(result["session_token"], str) and result["session_token"]

    def test_success_establishes_real_session_for_bob(self, store):
        bob = seed_bob(store)
        token = LoginService(store).login(BOB, RIGHT_PASSWORD)["session_token"]
        session = store.getSession(token)
        assert session is not None
        assert session["user_id"] == bob["id"]

    def test_success_shape_exact_and_no_hash_material(self, store):
        seed_bob(store)
        result = LoginService(store).login(BOB, RIGHT_PASSWORD)
        assert set(result) == {"status", "user", "session_token"}
        assert set(result["user"]) == {"id", "username"}
        blob = repr(result)
        assert "password_hash" not in blob
        assert "salt" not in blob
        assert RIGHT_PASSWORD not in blob

    def test_repeated_logins_get_distinct_tokens(self, store):
        seed_bob(store)
        svc = LoginService(store)
        tokens = {svc.login(BOB, RIGHT_PASSWORD)["session_token"] for _ in range(3)}
        assert len(tokens) == 3


# ------------------------------------- TC-05~07 统一失败语义（验收 2）


class TestLoginFailureUnified:
    @pytest.mark.parametrize(
        "username,password",
        [
            (BOB, WRONG_PASSWORD),
            (GHOST, "whatever"),
            (GHOST, RIGHT_PASSWORD),
        ],
    )
    def test_failures_return_unified_error_without_token(self, store, username, password):
        seed_bob(store)
        result = LoginService(store).login(username, password)
        assert result == UNIFIED_ERROR

    def test_wrong_password_and_unknown_user_responses_indistinguishable(self, store):
        seed_bob(store)
        svc = LoginService(store)
        wrong_password = svc.login(BOB, WRONG_PASSWORD)
        unknown_user = svc.login(GHOST, "any-password")
        assert wrong_password == unknown_user
        assert repr(wrong_password) == repr(unknown_user)

    @pytest.mark.parametrize(
        "username,password",
        [
            (BOB, WRONG_PASSWORD),
            (GHOST, "whatever"),
        ],
    )
    def test_failure_does_not_grow_session_table(self, store, username, password):
        seed_bob(store)
        LoginService(store).login(username, password)
        assert count_sessions(store) == 0

    def test_failure_never_calls_create_session(self, store):
        seed_bob(store)
        spy = SessionSpy(store)
        svc = LoginService(store, create_session_on_login=spy)
        assert svc.login(BOB, WRONG_PASSWORD) == UNIFIED_ERROR
        assert svc.login(GHOST, "x") == UNIFIED_ERROR
        assert spy.calls == []


# ------------------------------------------ TC-08 成功语义：会话建立恰好一次


class TestSessionCreation:
    def test_success_calls_create_session_once_with_user_id(self, store):
        bob = seed_bob(store)
        spy = SessionSpy(store)
        result = LoginService(store, create_session_on_login=spy).login(BOB, RIGHT_PASSWORD)
        assert spy.calls == [bob["id"]]
        assert result["session_token"]

    def test_token_normalization_accepts_plain_string_factory(self, store):
        seed_bob(store)
        svc = LoginService(store, create_session_on_login=lambda user_id: "tok-42")
        assert svc.login(BOB, RIGHT_PASSWORD)["session_token"] == "tok-42"


# -------------------------------------- TC-09 防枚举时序口径（诱饵校验不变量）


class TestAntiEnumeration:
    @pytest.mark.parametrize(
        "username,password",
        [
            (BOB, RIGHT_PASSWORD),
            (BOB, WRONG_PASSWORD),
            (GHOST, "any-password"),
        ],
    )
    def test_exactly_one_verify_call_per_attempt(self, store, username, password):
        seed_bob(store)
        spy = VerifySpy()
        LoginService(store, verify_password=spy).login(username, password)
        assert len(spy.calls) == 1
        assert spy.calls[0][0] == password


# ---------------------------------------------------- TC-10~11 输入与存储健壮性


class TestRobustness:
    @pytest.mark.parametrize(
        "username,password",
        [
            (None, "x"),
            (BOB, None),
            (123, "x"),
            (BOB, b"password"),
            (None, None),
        ],
    )
    def test_non_string_inputs_unified_error_no_session(self, store, username, password):
        seed_bob(store)
        assert LoginService(store).login(username, password) == UNIFIED_ERROR
        assert count_sessions(store) == 0

    def test_corrupted_stored_credentials_fail_without_crash(self, store):
        seed_bob(store)
        con = sqlite3.connect(store.path)
        try:
            con.execute("UPDATE users SET salt = 'not-hex' WHERE username = ?", (BOB,))
            con.commit()
        finally:
            con.close()
        assert LoginService(store).login(BOB, RIGHT_PASSWORD) == UNIFIED_ERROR
        assert count_sessions(store) == 0


# ------------------------------------------- TC-12 全链路（真实 FP-001 + FP-002）


class TestEndToEnd:
    def test_register_then_login_full_chain(self, store):
        bob = register(store, BOB, RIGHT_PASSWORD)
        carol = register(store, "carol", "another-secret")
        svc = LoginService(store)

        ok_bob = svc.login(BOB, RIGHT_PASSWORD)
        assert ok_bob["status"] == "OK"
        assert store.getSession(ok_bob["session_token"])["user_id"] == bob["id"]

        ok_carol = svc.login("carol", "another-secret")
        assert ok_carol["status"] == "OK"
        assert store.getSession(ok_carol["session_token"])["user_id"] == carol["id"]

        assert svc.login("carol", RIGHT_PASSWORD) == UNIFIED_ERROR
        assert svc.login(BOB, "another-secret") == UNIFIED_ERROR


# ------------------------------------------------ TC-13 §6 内存会话占位路径


class UsersOnlyStore:
    """仅有 getUserByUsername 的内存用户表（FP-001 会话原语不可用的口径）."""

    def __init__(self, users):
        self._users = users

    def getUserByUsername(self, username):
        return self._users.get(username)


def users_only_with_bob():
    creds = hashPassword(RIGHT_PASSWORD)
    return UsersOnlyStore(
        {BOB: {"id": 1, "username": BOB, "password_hash": creds["hash"], "salt": creds["salt"]}}
    )


class TestMemorySessionPlaceholder:
    def test_users_only_store_still_logs_in_with_placeholder_token(self):
        svc = LoginService(users_only_with_bob())
        result = svc.login(BOB, RIGHT_PASSWORD)
        assert result["status"] == "OK"
        assert result["session_token"]

    def test_failures_do_not_grow_placeholder_tokens(self):
        svc = LoginService(users_only_with_bob())
        svc.login(BOB, WRONG_PASSWORD)
        svc.login(GHOST, "x")
        assert svc.session_placeholder.tokens == set()
