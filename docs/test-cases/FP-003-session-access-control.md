# 测试场景 FP-003：会话管理与访问控制

对应验收（任务卡 §7）：
- A-保持：alice 登录成功后携带凭据 → currentUser 返回 alice；凭据关闭 / 过期后失效；
- B-拦截：无凭据或过期凭据访问受限页 → 跳转登录页（不放行、不 403）；
- C-销毁：logout 后原凭据失效，再访问受限页视为未登录跳转登录页。

## 一、会话存取原语（tests/session-store.test.js，内存适配层 = §3.2 契约消费端）

| # | 场景 | 期望 |
| --- | --- | --- |
| U1 | createSession(1) 返回形状 | `{token, expires_at}`；expires_at 为未来时刻（ISO 8601） |
| U2 | 有效 token getSession | 返回 `{user_id:1, expires_at}`，与建会话时一致 |
| U3 | 未知 / 已销毁 token getSession | 一律 `null` |
| U4 | 过期 token getSession | `null`（惰性清理：再查同 token 仍 null） |
| U5 | expires_at 恰等于当前时刻 | 视为过期（`<=` 边界，与 FP-001 语义一致） |
| U6 | destroySession 幂等 | 不存在的 token 不抛错；销毁后立即失效 |
| U7 | getUserById(1) | 种子用户 alice（含 id / username）；未知 id → `null` |
| U8 | 种子会话（§6） | `seed-token-1` → alice 有效；`seed-token-expired` → `null` |
| U9 | 重启语义（Mock 边界） | 内存 store 为进程内状态；持久化归 FP-001 / 集成桥接，本任务不测落盘 |

## 二、会话能力（tests/session-access.test.js）

| # | 场景 | 期望 |
| --- | --- | --- |
| A1 | createSessionOnLogin(1) | 返回 `{token, expires_at}`；store 中可解析回 user_id=1 |
| A2 | token 随机性 sanity | 200 个 token 全部互异；均匹配 `^[0-9a-f]{64}$`；不含 username 子串 |
| A3 | 同一用户两次登录 | 得到两个不同 token，各自独立有效 |
| A4 | currentUser：携带有效 token Cookie | 返回 `{id:1, username:'alice'}` |
| A5 | currentUser：无 Cookie / 无 session_token 键 / 空值 / 未知 token / 过期种子 token | 一律 `null` |
| A6 | currentUser：user 已不存在（孤儿会话） | `null`（不放行） |
| A7 | Cookie 解析边界 | 多键 Cookie（`a=1; session_token=..; b=2`）、键值含空格、缺 `=` 与空名片段安全跳过、重复键不崩溃 |
| A8 | logout(token) | store 内立即失效 → currentUser `null`；logout 未知 token 幂等不抛错 |
| A9 | 会话过期（假时钟推进越过 TTL） | currentUser 变 `null`（过期后失效） |
| A10 | sessionCookie 序列化 | 含 `session_token=`、`HttpOnly`、`SameSite=Lax`、`Path=/`、`Max-Age>0` |
| A11 | clearSessionCookie | `Max-Age=0` 且值为空（浏览器侧立即清除） |
| A12 | requireLogin：已登录请求 | 返回 `{id, username}` 且**不写**响应（放行由调用方继续渲染） |
| A13 | requireLogin：未登录请求 | 返回 `null` 且响应为 302 `Location: /login`（跳转，不 403） |

## 三、HTTP 层访问控制（tests/access-control.test.js，createWebServer({ sessionAccess })）

| # | 场景 | 期望 |
| --- | --- | --- |
| H1 | 匿名访问受限页 `/users` `/compose` `/timeline` | 各自 302 → `/login`（不放行、不 403） |
| H2 | 过期种子凭据（seed-token-expired）访问 `/users` | 302 → `/login` |
| H3 | 有效凭据（createSessionOnLogin 后）访问受限三页 | 200，统一布局，导航显示 alice / 已登录 / 退出入口 |
| H4 | 未受限页 `/` `/login` `/register` 匿名访问 | 200（注册 / 登录页本身不受限） |
| H5 | GET `/logout` 携带有效凭据 | 302 → `/login` + Set-Cookie 清除（Max-Age=0）；**原 token 再访问 `/users` → 302**（销毁语义） |
| H6 | GET `/logout` 无凭据 | 幂等：302 → `/login`，不抛错 |
| H7 | 生产组装（startServer 默认注入） | 匿名 `/users` → 302，`/` → 200（FP-004/005 行为不回归） |
| H8 | 已登录会话在布局中贯通 | 受限页 HTML 含 `data-login-state="logged-in"` 与 `data-testid="current-username"` |
| H9 | 未注入 sessionAccess 的基线 | `createWebServer()` 匿名访问受限占位页仍 200（FP-004 契约零破坏） |

## 四、既有回归

- `tests/current-user.test.js` C1（默认注入点恒 null）保持通过；
- `npm test` 全量（FP-004/005 既有 31 用例）+ FP-001 pytest 全量不回归。
