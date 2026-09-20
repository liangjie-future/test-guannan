"""FP-001 核心数据模型与存储：用户 / 帖子 / 关注关系 / 会话的持久化层.

对外提供 DataStore（§3.2 契约接口）与错误类型，供注册登录、关注、发帖、
时间线等后续任务消费。存储为嵌入式 SQLite 单文件，重启后数据仍可读回。
"""

from storage.store import (
    DEFAULT_SESSION_TTL,
    DataStore,
    SelfFollowError,
    StorageError,
    UsernameAlreadyExistsError,
)

__all__ = [
    "DEFAULT_SESSION_TTL",
    "DataStore",
    "SelfFollowError",
    "StorageError",
    "UsernameAlreadyExistsError",
]
