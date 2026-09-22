"""FP-001 核心数据模型与存储：四表 schema 与 §3.2 契约接口实现."""

import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_SESSION_TTL = timedelta(days=7)

# IN (...) 查询分块上限：防 SQLite 绑定变量数限制（口径同 getPostsByAuthorIds）
_ID_CHUNK_SIZE = 500

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id  INTEGER NOT NULL REFERENCES users(id),
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);

CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id),
    followee_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_followee_id ON follows(followee_id);

CREATE TABLE IF NOT EXISTS likes (
    post_id    INTEGER NOT NULL REFERENCES posts(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id);

CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
"""


class StorageError(Exception):
    """存储层错误基类."""


class UsernameAlreadyExistsError(StorageError):
    """createUser 用户名冲突：「用户名已存在」."""


class SelfFollowError(StorageError):
    """禁止 follower_id = followee_id 的自关注（§3.1 应用层禁止）."""


def _now():
    return datetime.now(timezone.utc).isoformat()


class DataStore:
    """基于 SQLite 的四类核心数据存储，方法签名即共享契约（任务卡 §3.2）.

    close() 后重新 DataStore(path) 等价于应用重启。
    """

    def __init__(self, path):
        self.path = Path(path)
        self._conn = sqlite3.connect(str(self.path))
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self):
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()

    # ------------------------------------------------------------------ users

    def createUser(self, username, password_hash, salt):
        """写入用户，返回 user_id；用户名冲突抛 UsernameAlreadyExistsError."""
        try:
            cursor = self._conn.execute(
                "INSERT INTO users (username, password_hash, salt, created_at)"
                " VALUES (?, ?, ?, ?)",
                (username, password_hash, salt, _now()),
            )
            self._conn.commit()
        except sqlite3.IntegrityError:
            # 回滚失败语句留下的未决事务：否则连接将持有 SQLite 写锁，
            # 阻塞所有后续写入方直至超时（FP-007 并发注册验证发现的缺陷）
            self._conn.rollback()
            raise UsernameAlreadyExistsError("用户名已存在") from None
        return cursor.lastrowid

    def getUserByUsername(self, username):
        row = self._conn.execute(
            "SELECT id, username, password_hash, salt, created_at"
            " FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        return dict(row) if row else None

    def getUserById(self, id):
        row = self._conn.execute(
            "SELECT id, username, password_hash, salt, created_at"
            " FROM users WHERE id = ?",
            (id,),
        ).fetchone()
        return dict(row) if row else None

    def listUsers(self):
        rows = self._conn.execute(
            "SELECT id, username, created_at FROM users"
        ).fetchall()
        return [dict(row) for row in rows]

    # ------------------------------------------------------------------ posts

    def getPostById(self, id):
        row = self._conn.execute(
            "SELECT id, author_id, content, created_at FROM posts WHERE id = ?",
            (id,),
        ).fetchone()
        return dict(row) if row else None

    def createPost(self, author_id, content):
        """写入帖子（内容不做长度校验，规则归 FP-013），返回完整帖子对象."""
        created_at = _now()
        cursor = self._conn.execute(
            "INSERT INTO posts (author_id, content, created_at) VALUES (?, ?, ?)",
            (author_id, content, created_at),
        )
        self._conn.commit()
        return {
            "id": cursor.lastrowid,
            "author_id": author_id,
            "content": content,
            "created_at": created_at,
        }

    def getPostsByAuthorIds(self, author_ids):
        """按作者集合取帖：保证集合完备，顺序不保证（过滤 / 排序语义归 FP-015）."""
        ids = list(dict.fromkeys(author_ids))
        posts = []
        for start in range(0, len(ids), _ID_CHUNK_SIZE):
            chunk = ids[start : start + _ID_CHUNK_SIZE]
            placeholders = ", ".join("?" * len(chunk))
            rows = self._conn.execute(
                "SELECT id, author_id, content, created_at FROM posts"
                f" WHERE author_id IN ({placeholders})",
                chunk,
            ).fetchall()
            posts.extend(dict(row) for row in rows)
        return posts

    # ---------------------------------------------------------------- follows

    def followExists(self, follower_id, followee_id):
        row = self._conn.execute(
            "SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?",
            (follower_id, followee_id),
        ).fetchone()
        return row is not None

    def addFollow(self, follower_id, followee_id):
        """新增单向关注边；幂等（已存在则不重复插入）；自关注抛 SelfFollowError."""
        if follower_id == followee_id:
            raise SelfFollowError("不能关注自己")
        self._conn.execute(
            "INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)",
            (follower_id, followee_id),
        )
        self._conn.commit()

    def getFolloweeIds(self, user_id):
        rows = self._conn.execute(
            "SELECT followee_id FROM follows WHERE follower_id = ?", (user_id,)
        ).fetchall()
        return [row[0] for row in rows]

    # ------------------------------------------- likes / comments（FP-002 / FP-016）

    def addLike(self, post_id, user_id):
        """点赞（幂等）：已点赞则不重复插入；返回是否新建（内容规则归 FP-016 服务层）."""
        cursor = self._conn.execute(
            "INSERT OR IGNORE INTO likes (post_id, user_id, created_at)"
            " VALUES (?, ?, ?)",
            (post_id, user_id, _now()),
        )
        self._conn.commit()
        return cursor.rowcount == 1

    def getLikesByPostId(self, post_id):
        """取帖全部点赞；顺序不保证（过滤 / 排序语义归 FP-016 服务层）."""
        rows = self._conn.execute(
            "SELECT post_id, user_id, created_at FROM likes WHERE post_id = ?",
            (post_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def createComment(self, post_id, user_id, content):
        """写入评论（存储层不做内容校验，1–280 字规则归上层），返回完整评论行.

        同一用户对同一帖子可多次评论（全部保留，无唯一约束）。
        """
        created_at = _now()
        cursor = self._conn.execute(
            "INSERT INTO comments (post_id, user_id, content, created_at)"
            " VALUES (?, ?, ?, ?)",
            (post_id, user_id, content, created_at),
        )
        self._conn.commit()
        return {
            "id": cursor.lastrowid,
            "post_id": post_id,
            "user_id": user_id,
            "content": content,
            "created_at": created_at,
        }

    def getCommentsByPostIds(self, post_ids):
        """按帖集合取评论：created_at 正序（早→晚），同时刻按 id 升序.

        集合完备（可见性过滤归 FP-004 服务层）；入参去重；空入参返回 []。
        排序以收集后的单次排序为唯一权威（IN 分块查询不保证跨块有序）；
        created_at 为同格式 UTC ISO 文本，字典序即时间序，跨时区偏移文本的
        瞬间归一归服务层（口径同 FP-015 / FP-016）。
        """
        ids = list(dict.fromkeys(post_ids))
        comments = []
        for start in range(0, len(ids), _ID_CHUNK_SIZE):
            chunk = ids[start : start + _ID_CHUNK_SIZE]
            placeholders = ", ".join("?" * len(chunk))
            rows = self._conn.execute(
                "SELECT id, post_id, user_id, content, created_at FROM comments"
                f" WHERE post_id IN ({placeholders})",
                chunk,
            ).fetchall()
            comments.extend(dict(row) for row in rows)
        comments.sort(key=lambda row: (row["created_at"], row["id"]))
        return comments

    def addComment(self, post_id, user_id, content):
        """FP-016 规范名：同 createComment（唯一实现见 createComment）."""
        return self.createComment(post_id, user_id, content)

    def getCommentsByPostId(self, post_id):
        """FP-016 规范名：单帖查询，委托 getCommentsByPostIds（顺序不保证契约不破坏）."""
        return self.getCommentsByPostIds([post_id])

    # --------------------------------------------------------------- sessions

    def createSession(self, user_id, ttl=None):
        """建立会话，返回 {token, expires_at}；token 随机不可预测."""
        ttl = DEFAULT_SESSION_TTL if ttl is None else ttl
        token = secrets.token_hex(32)
        expires_at = self._insertSession(token, user_id, ttl)
        return {"token": token, "expires_at": expires_at}

    def _insertSession(self, token, user_id, ttl):
        expires_at = (datetime.now(timezone.utc) + ttl).isoformat()
        self._conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at)"
            " VALUES (?, ?, ?, ?)",
            (token, user_id, _now(), expires_at),
        )
        self._conn.commit()
        return expires_at

    def getSession(self, token):
        """读取会话；无效 / 过期 / 已销毁一律返回 None（过期行惰性清理）."""
        row = self._conn.execute(
            "SELECT user_id, expires_at FROM sessions WHERE token = ?", (token,)
        ).fetchone()
        if row is None:
            return None
        if datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
            self.destroySession(token)
            return None
        return {"user_id": row["user_id"], "expires_at": row["expires_at"]}

    def destroySession(self, token):
        """销毁会话；不存在的 token 幂等不报错."""
        self._conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        self._conn.commit()
