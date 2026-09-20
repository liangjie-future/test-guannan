"""FP-011 关注关系规则：FollowService 与错误类型.

对外提供 follow / getFollowees 能力（§3.2 共享契约），消费 FP-001 存储
契约（或其内存模拟）。
"""

from services.follow import (
    FollowError,
    FolloweeNotFoundError,
    FollowService,
    SelfFollowNotAllowedError,
)

__all__ = [
    "FollowError",
    "FolloweeNotFoundError",
    "FollowService",
    "SelfFollowNotAllowedError",
]
