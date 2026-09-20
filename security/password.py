"""FP-002 密码加密存储：单向慢散列 + 独立随机盐的生成与恒时校验.

算法 PBKDF2-HMAC-SHA256（标准库，零第三方依赖），迭代 600,000 次（OWASP 现行
建议值，实测单次 ≈0.1s）；盐为 CSPRNG 128 bit，每次调用独立生成。
明文不落盘、不进日志：本模块零日志，返回值仅含 {hash, salt}（§4 检查口径）。
"""

import hashlib
import hmac
import secrets

ALGORITHM = "pbkdf2-hmac-sha256"
ITERATIONS = 600_000
SALT_BYTES = 16
HASH_BYTES = 32
SALT_HEX_LENGTH = SALT_BYTES * 2
HASH_HEX_LENGTH = HASH_BYTES * 2


def _pbkdf2(plain_password, salt, iterations):
    return hashlib.pbkdf2_hmac(
        "sha256", plain_password.encode("utf-8"), salt, iterations, dklen=HASH_BYTES
    )


def _decode_hex_or_none(value):
    if not isinstance(value, str):
        return None
    try:
        return bytes.fromhex(value)
    except ValueError:
        return None


def hashPassword(plain_password, *, iterations=ITERATIONS):
    """明文 → {hash, salt}：独立随机盐 + 单向慢散列；返回值不含明文.

    iterations 仅为测试 / 未来参数升级留缝，调用方（FP-007 注册 / FP-009 登录）无需传。
    """
    if not isinstance(plain_password, str):
        raise TypeError("plain_password 必须为 str")
    salt = secrets.token_bytes(SALT_BYTES)
    digest = _pbkdf2(plain_password, salt, iterations)
    return {"hash": digest.hex(), "salt": salt.hex()}


def verifyPassword(plain_password, salt, stored_hash, *, iterations=ITERATIONS):
    """以存储盐重算散列并与存储散列恒时比对（hmac.compare_digest）→ True | False.

    存储侧数据畸形（非 hex / 长度不符 / 非字符串）一律 False，不抛异常——
    登录流程（FP-009）只需处理布尔。
    """
    if not isinstance(plain_password, str):
        raise TypeError("plain_password 必须为 str")
    salt_bytes = _decode_hex_or_none(salt)
    stored_bytes = _decode_hex_or_none(stored_hash)
    if salt_bytes is None or len(salt_bytes) != SALT_BYTES:
        return False
    if stored_bytes is None or len(stored_bytes) != HASH_BYTES:
        return False
    digest = _pbkdf2(plain_password, salt_bytes, iterations)
    return hmac.compare_digest(digest, stored_bytes)
