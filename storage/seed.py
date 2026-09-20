"""FP-001 验证用种子数据（任务卡 §6）.

用法：
    python -m storage.seed <db路径>   # CLI 写入
    from storage import DataStore, load_seed   # 代码写入

内容：用户 alice / bob / carol（password_hash、salt 为占位值）；帖子 4 条
（bob、carol 各 2 条）；关注边 alice→bob、alice→carol；会话 token="seed-token-1"。
重复执行幂等（已存在的实体跳过，不报错、不重复）。
"""

import sys
from pathlib import Path

from storage.store import DEFAULT_SESSION_TTL, DataStore

SEED_SESSION_TOKEN = "seed-token-1"

_SEED_USERS = [
    ("alice", "hash-alice-placeholder", "salt-alice-placeholder"),
    ("bob", "hash-bob-placeholder", "salt-bob-placeholder"),
    ("carol", "hash-carol-placeholder", "salt-carol-placeholder"),
]

_SEED_POSTS = {
    "bob": ["bob 的第 1 条种子帖子", "bob 的第 2 条种子帖子"],
    "carol": ["carol 的第 1 条种子帖子", "carol 的第 2 条种子帖子"],
}

_SEED_FOLLOWS = [("alice", "bob"), ("alice", "carol")]


def load_seed(store):
    """向 store 写入种子数据；逐实体 get-or-create，天然幂等."""
    ids = {}
    for username, password_hash, salt in _SEED_USERS:
        user = store.getUserByUsername(username)
        ids[username] = (
            user["id"] if user else store.createUser(username, password_hash, salt)
        )

    for username, contents in _SEED_POSTS.items():
        uid = ids[username]
        existing = len(store.getPostsByAuthorIds({uid}))
        for content in contents[existing:]:
            store.createPost(uid, content)

    for follower, followee in _SEED_FOLLOWS:
        store.addFollow(ids[follower], ids[followee])

    if store.getSession(SEED_SESSION_TOKEN) is None:
        store._insertSession(SEED_SESSION_TOKEN, ids["alice"], DEFAULT_SESSION_TTL)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("用法: python -m storage.seed <db路径>", file=sys.stderr)
        return 2
    db_path = Path(argv[0])
    with DataStore(db_path) as store:
        load_seed(store)
    print(f"种子数据已写入 {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
