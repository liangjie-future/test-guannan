"""FP-002 密码加密存储：hashPassword / verifyPassword 纯能力接口（§3.2 契约）.

供注册建号（FP-007，写入侧）与登录校验（FP-009，比对侧）消费；
与 FP-001 的 storage.DataStore 平级——密码散列是安全能力，不属存储层职责。
"""

from security.password import (
    ALGORITHM,
    HASH_BYTES,
    HASH_HEX_LENGTH,
    ITERATIONS,
    SALT_BYTES,
    SALT_HEX_LENGTH,
    hashPassword,
    verifyPassword,
)

__all__ = [
    "ALGORITHM",
    "HASH_BYTES",
    "HASH_HEX_LENGTH",
    "ITERATIONS",
    "SALT_BYTES",
    "SALT_HEX_LENGTH",
    "hashPassword",
    "verifyPassword",
]
