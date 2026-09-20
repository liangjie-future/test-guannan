"""FP-009 登录校验：核对凭证 → 建会话进登录态（统一失败语义）.

链路（任务卡 §4）：getUserByUsername → verifyPassword → createSessionOnLogin。
失败语义（§3.2）：用户名不存在与密码错误返回完全相同的错误
{status: "ERROR", message: "用户名或密码错误"}——不区分哪项错（防账号枚举），
且失败一律不建立会话（createSessionOnLogin 仅在校验通过后触达，结构保证）。
"""

from security.password import hashPassword, verifyPassword

STATUS_OK = "OK"
STATUS_ERROR = "ERROR"

LOGIN_ERROR_MESSAGE = "用户名或密码错误"

_decoy = None


def _decoy_credentials():
    """时序均衡诱饵（懒生成，进程一次）：用户名不存在时的恒定散列工作量.

    「查无此人提前返回」不做 PBKDF2（≈0ms）与「密码错误」（≈0.1s）耗时可区分，
    构成账号枚举侧信道；诱饵比对结果丢弃，仅拉平成本。
    """
    global _decoy
    if _decoy is None:
        _decoy = hashPassword("fp-009-timing-decoy")
    return _decoy


def _token_of(session):
    """归一 §3.2 契约返回形态：token 字符串或 {token, ...} 均取 token."""
    return session["token"] if isinstance(session, dict) else session


class _MemorySessionPlaceholder:
    """§6 会话占位：store 无会话原语时的最小 createSessionOnLogin（FP-003 未合入口径）.

    仅承接「成功建会话」事件形状；过期 / 销毁等生命周期归 FP-003。
    """

    def __init__(self):
        self.tokens = set()

    def createSessionOnLogin(self, user_id):
        token = f"seed-session-{len(self.tokens) + 1}"
        self.tokens.add(token)
        return token


def _unified_error():
    """统一失败响应：每次构造全新 dict，两失败路径深相等、响应不可区分."""
    return {"status": STATUS_ERROR, "message": LOGIN_ERROR_MESSAGE}


class LoginService:
    """登录校验服务：组合 §3.2 三项依赖契约.

    store 须提供 getUserByUsername（FP-001 契约，如 storage.DataStore）；
    verify_password / create_session_on_login 可注入替换（默认绑定真实实现，
    见类文档与设计笔记）。
    """

    def __init__(self, store, verify_password=None, create_session_on_login=None):
        self._store = store
        self._verify = verifyPassword if verify_password is None else verify_password
        self.session_placeholder = None
        if create_session_on_login is None:
            create_session = getattr(store, "createSession", None)
            if create_session is None:
                # FP-003 产在 Node，Python 进程以 FP-001 会话原语适配；原语亦
                # 不可用时回退 §6 内存占位（种子风格 token）。
                self.session_placeholder = _MemorySessionPlaceholder()
                create_session_on_login = self.session_placeholder.createSessionOnLogin
            else:
                create_session_on_login = create_session
        self._create_session_on_login = create_session_on_login

    def login(self, username, password):
        """核对用户名密码；成功建立会话进入登录态，失败统一提示且不建会话.

        成功 → {status: "OK", user: {id, username}, session_token}；
        失败 → {status: "ERROR", message: "用户名或密码错误"}（不可区分哪项错）。
        """
        if not isinstance(username, str) or not isinstance(password, str):
            return _unified_error()

        user = self._store.getUserByUsername(username)
        if user is None:
            decoy = _decoy_credentials()
            self._verify(password, decoy["salt"], decoy["hash"])
            return _unified_error()
        if not self._verify(password, user["salt"], user["password_hash"]):
            return _unified_error()

        token = _token_of(self._create_session_on_login(user["id"]))
        return {
            "status": STATUS_OK,
            "user": {"id": user["id"], "username": user["username"]},
            "session_token": token,
        }
