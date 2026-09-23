# FP-002 真实认证、会话、用户与关注测试场景

## 真实 Python / SQLite 链路

- 空库注册合法用户名和 6 位以上密码，返回动态用户 ID、Python session token 和 7 天附近的 `expires_at`。
- 注册响应 Cookie 只有 Python token，包含 `Path=/`、`HttpOnly`、`SameSite=Lax` 和正的 `Max-Age`，注册后可访问 `/users`、`/compose`、`/timeline`。
- 已存在用户名返回 `USERNAME_TAKEN`，短密码返回 `PASSWORD_TOO_SHORT`；两者都不增加用户或 session。
- 正确登录返回新 token；错误用户名和错误密码都返回完全相同的“用户名或密码错误”，且不创建 session。
- 退出调用 Python 销毁 token、清除 Cookie；旧 token、未知 token、过期 token访问所有受限页均 `302 /login`。
- A/B/C 用户列表返回全部真实用户名、动态 SQLite ID，A 自己没有可用关注按钮，已关注状态来自 A 的 Python followee IDs。
- A 对 B 重复关注两次均成功且 `created` 分别反映创建/幂等，SQLite 只有一条关系。
- A 关注自己返回 `SELF_FOLLOW_NOT_ALLOWED`，关注不存在 ID 返回 `FOLLOWEE_NOT_FOUND`。
- 关闭并重启服务后，账户、关注关系和未退出 session 仍然有效。

## Node 注入式边界与故障

- fake bridge 返回动态 ID 时页面不假设固定用户编号。
- bridge 不可用、超时、协议错误、存储错误均映射为 503；业务错误不误报 503。
- list-users 的用户列表和 followee IDs 来自同一 bridge 请求。
- 注册、登录成功不会额外调用 Node `createSession`；退出只调用 Python `logout`。
