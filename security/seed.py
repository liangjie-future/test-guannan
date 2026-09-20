"""FP-002 验证用种子数据（任务卡 §6）：2 名种子用户，各自独立盐与散列.

用法：
    python -m security.seed <db路径>   # CLI 写入
    from security.seed import load_seed   # 代码写入

内容：seed-password-a（明文 password123）、seed-password-b（明文 hunter2），
经 hashPassword 散列后入库（明文不入库）。重复执行幂等（已存在用户跳过）。
"""

import sys
from pathlib import Path

from security.password import hashPassword
from storage import DataStore

SEED_USERS = [
    ("seed-password-a", "password123"),
    ("seed-password-b", "hunter2"),
]


def load_seed(store):
    """向 store 写入种子用户；逐个 get-or-create，天然幂等."""
    for username, plain in SEED_USERS:
        if store.getUserByUsername(username) is None:
            creds = hashPassword(plain)
            store.createUser(username, creds["hash"], creds["salt"])


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("用法: python -m security.seed <db路径>", file=sys.stderr)
        return 2
    db_path = Path(argv[0])
    with DataStore(db_path) as store:
        load_seed(store)
    print(f"种子用户已写入 {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
