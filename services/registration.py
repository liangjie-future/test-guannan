"""FP-007 注册规则与建号：register 服务（校验 → 散列 → 建号 → 登录态）.

消费 §3.2 契约：FP-001 `getUserByUsername` / `createUser`（冲突「用户名已存在」）、
FP-002 `hashPassword`（默认真实实现）、FP-003 `createSessionOnLogin(user_id) →
token`（默认以 FP-001 会话原语 store.createSession 派生，联调时可注入访问
控制层自有工厂）。对上游（FP-006 注册页）提供带规则的能力：

    register(username, password) →
      成功 {"status": "OK", "user": {id, username}, "session_token"}
      失败 {"status": "ERROR", "reason": USERNAME_TAKEN | PASSWORD_TOO_SHORT}

规则：密码最小长度 6 位（含边界）；用户名唯一（预检 + 唯一约束兜底，
同一注册并发 / 重复提交仅产生一个账号）。失败不建号、不建会话。
"""

from security import hashPassword
from storage import UsernameAlreadyExistsError

MIN_PASSWORD_LENGTH = 6

STATUS_OK = "OK"
STATUS_ERROR = "ERROR"

REASON_USERNAME_TAKEN = "USERNAME_TAKEN"
REASON_PASSWORD_TOO_SHORT = "PASSWORD_TOO_SHORT"


class RegistrationService:
    """注册服务：组合满足 §3.2 契约的 store 与可替换的散列 / 会话工厂."""

    def __init__(self, store, *, hash_password=None, create_session_on_login=None):
        self._store = store
        self._hash_password = hashPassword if hash_password is None else hash_password
        if create_session_on_login is None:

            def create_session_on_login(user_id):
                return store.createSession(user_id)["token"]

        self._create_session_on_login = create_session_on_login

    def register(self, username, password):
        """校验用户名唯一、密码 ≥6 位，通过后建号并进入登录态.

        校验顺序：用户名占用 → 密码长度 → 散列 → 建号 → 建会话；
        并发窗口内的用户名冲突由存储唯一约束兜底，映射为 USERNAME_TAKEN
        （不重复建号、不建会话）。全链路密码明文仅存在于内存入参，
        落库与返回值均只含散列。
        """
        if not isinstance(username, str):
            raise TypeError(f"username 必须为字符串，收到 {type(username).__name__}")
        if not isinstance(password, str):
            raise TypeError(f"password 必须为字符串，收到 {type(password).__name__}")

        if self._store.getUserByUsername(username) is not None:
            return self._error(REASON_USERNAME_TAKEN)
        if len(password) < MIN_PASSWORD_LENGTH:
            return self._error(REASON_PASSWORD_TOO_SHORT)

        creds = self._hash_password(password)
        try:
            user_id = self._store.createUser(username, creds["hash"], creds["salt"])
        except UsernameAlreadyExistsError:
            return self._error(REASON_USERNAME_TAKEN)

        return {
            "status": STATUS_OK,
            "user": {"id": user_id, "username": username},
            "session_token": self._create_session_on_login(user_id),
        }

    @staticmethod
    def _error(reason):
        return {"status": STATUS_ERROR, "reason": reason}
