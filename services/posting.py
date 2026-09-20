"""FP-013 发帖内容规则：createPost 服务（校验 + 保存）.

消费 FP-001 §3.2 契约（getUserById / createPost），对上游提供带规则的
createPost 能力：1–280 字非空纯文本（去首尾空白后按码点计）方可落库。
"""

MAX_POST_LENGTH = 280

STATUS_OK = "OK"
STATUS_ERROR = "ERROR"

REASON_EMPTY_CONTENT = "EMPTY_CONTENT"
REASON_TOO_LONG = "TOO_LONG"
REASON_AUTHOR_NOT_FOUND = "AUTHOR_NOT_FOUND"


class PostService:
    """发帖服务：依赖任意满足 §3.2 最小契约的 store（如 storage.DataStore）."""

    def __init__(self, store):
        self._store = store

    def createPost(self, author_id, content):
        """校验并保存帖子.

        成功 → {"status": "OK", "post": {id, author_id, content, created_at}}；
        失败 → {"status": "ERROR", "reason": AUTHOR_NOT_FOUND | EMPTY_CONTENT | TOO_LONG}，
        校验顺序：作者存在 → 内容非空 → 长度 ≤ 280；失败不触达写入。
        """
        if not isinstance(content, str):
            raise TypeError(f"content 必须为字符串，收到 {type(content).__name__}")

        if self._store.getUserById(author_id) is None:
            return self._error(REASON_AUTHOR_NOT_FOUND)

        text = content.strip()
        if not text:
            return self._error(REASON_EMPTY_CONTENT)
        if len(text) > MAX_POST_LENGTH:
            return self._error(REASON_TOO_LONG)

        return {"status": STATUS_OK, "post": self._store.createPost(author_id, text)}

    @staticmethod
    def _error(reason):
        return {"status": STATUS_ERROR, "reason": reason}
