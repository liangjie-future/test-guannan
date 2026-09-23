# FP-002 真实认证、会话、用户与关注设计

## 方案

- Node 通过现有同步 `spawnSync` bridge 调用单请求 Python worker，所有用户、session 和关注关系只落在 `DATA_DIR/social.db`。
- Python worker 直接组合 `RegistrationService`、`LoginService`、`FollowService` 与 `DataStore`。认证成功返回的 `session_token` 原样作为唯一浏览器 Cookie，不在 Node 创建第二个 session。
- `current_user`、`list_users` 和 `follow` 均以请求 Cookie 中的 token 为入口在 Python 校验；`list_users` 在同一 worker 请求中读取用户列表和当前用户的 followee IDs，避免 Node 内存状态漂移。
- Node `session-access` 只负责解析 Cookie、调用 bridge 的 current-user/logout，并把无效、过期、已退出 token 统一映射为登录重定向。桥接、协议和存储异常保留为 503。
- 注册页和登录页由服务返回的 `expires_at` 生成 Cookie TTL；页面层不再调用 `createSession`，关注动作委托 Python 返回的业务错误码。

## 关键决策

- 保留注入式 fake 服务接口以兼容现有页面单测，但生产 `startServer()` 只装配真实 bridge 服务。
- Python 业务错误使用结构化 envelope code，Node 将 `USERNAME_TAKEN`、`PASSWORD_TOO_SHORT`、`LOGIN_INVALID`、`SELF_FOLLOW_NOT_ALLOWED` 和 `FOLLOWEE_NOT_FOUND` 映射为页面文案；系统错误统一 503。
- `logout` 对不存在 token 保持幂等，响应清除 Cookie；旧 token 后续由 Python `getSession` 返回未登录。
- 不使用 `storage/seed.py` 或 Node 社交内存 store；重启只重新打开同一 SQLite 文件，保留账户、关注和未退出 session。
