"""FP-002 密码加密存储 —— 测试套件.

对应 docs/test-cases/FP-002-password-hash.md（TC-01 ~ TC-09）。
"""

import subprocess
import sys

import pytest

from security import hashPassword, verifyPassword
from security.password import HASH_HEX_LENGTH, SALT_HEX_LENGTH
from security.seed import SEED_USERS, load_seed
from storage import DataStore, UsernameAlreadyExistsError

PLAIN_A = "password123"
PLAIN_B = "hunter2"


@pytest.fixture()
def store(tmp_path):
    """空存储：每个测试独立 SQLite 文件（FP-001 已合入，走真实持久化）."""
    s = DataStore(tmp_path / "social.db")
    yield s
    s.close()


def register(store, username, plain):
    """模拟注册建号：散列入库，返回 user_id（明文不入库）."""
    creds = hashPassword(plain)
    return store.createUser(username, creds["hash"], creds["salt"]), creds


# --------------------------------------------------- TC-01 hashPassword 契约

class TestHashPassword:
    def test_returns_hash_and_salt_only(self):
        creds = hashPassword(PLAIN_A)
        assert set(creds) == {"hash", "salt"}

    def test_outputs_are_nonempty_hex_of_expected_length(self):
        creds = hashPassword(PLAIN_A)
        assert len(creds["salt"]) == SALT_HEX_LENGTH
        assert len(creds["hash"]) == HASH_HEX_LENGTH
        bytes.fromhex(creds["salt"])
        bytes.fromhex(creds["hash"])

    def test_no_plaintext_in_outputs(self):
        for creds in (hashPassword(PLAIN_A), hashPassword(PLAIN_B)):
            blob = repr(creds)
            assert PLAIN_A not in blob
            assert PLAIN_B not in blob
            assert PLAIN_A[:8] not in blob
            assert PLAIN_B[:6] not in blob

    def test_salt_unique_per_call(self):
        salts = {hashPassword(PLAIN_A)["salt"] for _ in range(8)}
        assert len(salts) == 8

    @pytest.mark.parametrize("bad", [None, 123, b"password123"])
    def test_non_string_password_raises(self, bad):
        with pytest.raises(TypeError):
            hashPassword(bad)


# -------------------------------------------------- TC-02 verifyPassword 比对

class TestVerifyPassword:
    def test_correct_password_true(self):
        creds = hashPassword(PLAIN_A)
        assert verifyPassword(PLAIN_A, creds["salt"], creds["hash"]) is True

    @pytest.mark.parametrize(
        "wrong",
        [
            "Password123",
            "password12",
            "password123 ",
            "",
            "password1234",
            PLAIN_B,
        ],
    )
    def test_wrong_password_false(self, wrong):
        creds = hashPassword(PLAIN_A)
        assert verifyPassword(wrong, creds["salt"], creds["hash"]) is False

    def test_unicode_password_roundtrip(self):
        plain = "密码🎉pässwörd"
        creds = hashPassword(plain)
        assert verifyPassword(plain, creds["salt"], creds["hash"]) is True
        assert verifyPassword("密码", creds["salt"], creds["hash"]) is False

    def test_very_long_password_roundtrip(self):
        plain = "a1" * 512
        creds = hashPassword(plain)
        assert verifyPassword(plain, creds["salt"], creds["hash"]) is True

    @pytest.mark.parametrize("bad", [None, 123, b"password123"])
    def test_non_string_password_raises(self, bad):
        creds = hashPassword(PLAIN_A)
        with pytest.raises(TypeError):
            verifyPassword(bad, creds["salt"], creds["hash"])

    def test_iterations_is_part_of_computation(self):
        creds = hashPassword(PLAIN_A, iterations=1_000)
        same = verifyPassword(PLAIN_A, creds["salt"], creds["hash"], iterations=1_000)
        assert same is True
        assert verifyPassword(PLAIN_A, creds["salt"], creds["hash"]) is False


# ------------------------------------------- TC-03 同明文不同盐 → 不同散列

class TestIndependentSalt:
    def test_same_plaintext_two_users_differ(self):
        a = hashPassword(PLAIN_A)
        b = hashPassword(PLAIN_A)
        assert a["salt"] != b["salt"]
        assert a["hash"] != b["hash"]

    def test_both_users_still_verify(self):
        for creds in (hashPassword(PLAIN_A), hashPassword(PLAIN_A)):
            assert verifyPassword(PLAIN_A, creds["salt"], creds["hash"]) is True


# ------------------------------------------------------ TC-04 篡改 → False

class TestTamperedStoredData:
    def test_flipped_salt_char_fails(self):
        creds = hashPassword(PLAIN_A)
        flipped = "0" if creds["salt"][0] != "0" else "1"
        tampered = flipped + creds["salt"][1:]
        assert tampered != creds["salt"]
        assert verifyPassword(PLAIN_A, tampered, creds["hash"]) is False

    def test_flipped_hash_char_fails(self):
        creds = hashPassword(PLAIN_A)
        replacement = "0" if creds["hash"][0] != "0" else "1"
        tampered = replacement + creds["hash"][1:]
        assert verifyPassword(PLAIN_A, creds["salt"], tampered) is False

    def test_swapped_salt_between_users_fails(self):
        a = hashPassword(PLAIN_A)
        b = hashPassword(PLAIN_A)
        assert verifyPassword(PLAIN_A, b["salt"], a["hash"]) is False
        assert verifyPassword(PLAIN_A, a["salt"], b["hash"]) is False


# --------------------------------------------------- TC-05 畸形输入 → False

class TestMalformedStoredData:
    @pytest.mark.parametrize(
        "salt,stored",
        [
            ("zz-not-hex", "ab" * 32),
            ("", "ab" * 32),
            ("ab" * 16, ""),
            ("ab" * 16, "zz-not-hex"),
            (None, "ab" * 32),
            ("ab" * 16, None),
            (123, "ab" * 32),
            ("ab" * 16, 123),
            ("ab" * 15, "ab" * 32),
            ("ab" * 17, "ab" * 32),
            ("ab" * 16, "ab" * 31),
            ("ab" * 16, "ab" * 33),
        ],
    )
    def test_malformed_returns_false_without_raising(self, salt, stored):
        assert verifyPassword(PLAIN_A, salt, stored) is False


# ------------------------------------------------- TC-06 恒时比对与单向性

class TestOneWayAndConstantTime:
    def test_uses_constant_time_compare(self):
        import inspect

        from security import password

        source = inspect.getsource(password)
        assert "compare_digest" in source
        assert "logging" not in source
        assert "print(" not in source

    def test_hash_is_not_plaintext_nor_encoding_of_it(self):
        creds = hashPassword(PLAIN_A)
        blob = creds["hash"] + creds["salt"]
        assert PLAIN_A not in blob
        assert PLAIN_A.encode("utf-8").hex() not in blob
        assert PLAIN_A.encode("utf-8").hex()[:16] not in blob


# --------------------------------------- TC-07 与 FP-001 存储集成（注册全链路）

class TestStorageIntegration:
    def test_register_then_verify_roundtrip(self, store):
        user_id, creds = register(store, "newuser", PLAIN_A)
        row = store.getUserByUsername("newuser")
        assert row["id"] == user_id
        assert row["password_hash"] == creds["hash"]
        assert row["salt"] == creds["salt"]
        assert verifyPassword(PLAIN_A, row["salt"], row["password_hash"]) is True
        assert verifyPassword(PLAIN_B, row["salt"], row["password_hash"]) is False

    def test_username_conflict_still_enforced(self, store):
        register(store, "dup", PLAIN_A)
        with pytest.raises(UsernameAlreadyExistsError):
            register(store, "dup", PLAIN_B)

    def test_two_users_same_password_independent_records(self, store):
        _, a = register(store, "user-a", PLAIN_A)
        _, b = register(store, "user-b", PLAIN_A)
        assert a["salt"] != b["salt"]
        assert a["hash"] != b["hash"]
        assert verifyPassword(PLAIN_A, a["salt"], a["hash"]) is True
        assert verifyPassword(PLAIN_A, b["salt"], b["hash"]) is True


# ------------------------------------------------------------ TC-08 明文不落盘

class TestNoPlaintextAtRest:
    def test_sqlite_file_bytes_contain_no_plaintext(self, store, tmp_path):
        register(store, "diskuser", PLAIN_A)
        store.close()
        for path in sorted(tmp_path.iterdir()):
            raw = path.read_bytes()
            assert PLAIN_A.encode("utf-8") not in raw, path.name
            assert PLAIN_B.encode("utf-8") not in raw, path.name


# ------------------------------------------------------------- TC-09 种子数据

class TestSeed:
    def test_load_seed_two_users_verify(self, store):
        load_seed(store)
        for username, plain in SEED_USERS:
            row = store.getUserByUsername(username)
            assert row is not None
            assert verifyPassword(plain, row["salt"], row["password_hash"]) is True
            assert verifyPassword("wrong", row["salt"], row["password_hash"]) is False

    def test_seed_users_have_independent_salt_and_hash(self, store):
        load_seed(store)
        a = store.getUserByUsername(SEED_USERS[0][0])
        b = store.getUserByUsername(SEED_USERS[1][0])
        assert a["salt"] != b["salt"]
        assert a["password_hash"] != b["password_hash"]

    def test_load_seed_idempotent(self, store):
        load_seed(store)
        first = store.getUserByUsername(SEED_USERS[0][0])
        load_seed(store)
        again = store.getUserByUsername(SEED_USERS[0][0])
        assert first == again
        assert len(store.listUsers()) == len(SEED_USERS)

    def test_seed_cli(self, tmp_path):
        db = tmp_path / "seeded.db"
        result = subprocess.run(
            [sys.executable, "-m", "security.seed", str(db)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        s = DataStore(db)
        try:
            username, plain = SEED_USERS[0]
            row = s.getUserByUsername(username)
            assert row is not None
            assert verifyPassword(plain, row["salt"], row["password_hash"]) is True
        finally:
            s.close()
