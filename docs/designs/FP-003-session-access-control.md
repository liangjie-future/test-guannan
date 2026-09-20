# 设计笔记 FP-003：会话管理与访问控制

## 目标

交付会话全生命周期（登录成功建立 → 保持 → 过期 / 销毁）与受限页访问控制
（未登录跳转登录页，不 403、不放行），为用户列表 / 发帖 / 时间线等全部登录态功能提供门槛基座。

## 技术选型与整体形态

- **Node.js（≥18）+ 零第三方依赖**，与 FP-004/FP-005 的 Web 侧保持一致：
  `node:http` 请求 / 响应对象即中间件载体，`node:test` 验证。
- **凭据下发：Cookie**（`session_token`，HttpOnly + SameSite=Lax + Path=/）。
- **过期策略：固定时长**（默认 TTL 7 天，与 FP-001 `DEFAULT_SESSION_TTL` 对齐），
  `Max-Age` 与服务端 `expires_at` 一致；过期 / 销毁后凭据一律视为未登录。

## 模块结构

```
src/session-store.js    会话存取原语适配层（§3.2 依赖契约的消费端）
                        createMemorySessionStore() → 内存 Map 默认实现 + §6 种子
src/session-access.js   FP-003 核心：createSessionAccess({ store }) →
                        { createSessionOnLogin, currentUser, requireLogin, logout,
                          sessionCookie, clearSessionCookie, sessionTokenFromRequest }
src/server.js           组装点：createWebServer({ sessionAccess }) 挂载访问控制；
                        startServer() 默认注入内存 store 的 sessionAccess
tests/session-store.test.js     存取原语单测
tests/session-access.test.js    会话能力单测（含 Cookie 解析 / 随机性 sanity）
tests/access-control.test.js    HTTP 层访问控制（受限页 302 / 放行 / logout / 生产组装）
```

## 关键决策

1. **存取原语走 FP-001 §3.2 契约，跨语言以适配层衔接**：FP-001 产出是 Python
   SQLite 层，Node Web 进程无法进程内调用。本任务在 Node 侧定义同名契约
   （`createSession / getSession / destroySession / getUserById`），
   默认以**内存 Map 实现**（任务卡 §6 Mock 策略：token→{user_id, expires_at}，
   种子用户 alice id=1；种子会话 `seed-token-1` 有效、`seed-token-expired` 已过期），
   后续持久化桥接（如经 FP-001 Python 层的 CLI/服务化）属集成点，替换 store 注入即可，
   会话逻辑零改动。
2. **过期判定以服务端为准，Cookie Max-Age 仅对齐**：`getSession` 对无效 / 过期 /
   已销毁一律返回 null（过期行惰性删除，语义与 FP-001 一致）；`currentUser`
   凭 Cookie token 解析，任何一环失效即 null（会话状态机：过期或销毁后一律未登录）。
3. **token 随机不可预测**：`crypto.randomBytes(32).toString('hex')`（64 个 hex 字符，
   256 bit 熵），与 user_id / 用户名无任何关联；同一用户多次登录得到互不相同的 token。
4. **requireLogin 为可挂载的守卫函数**：`requireLogin(request, response)` →
   已登录返回 `{id, username}` 放行；未登录写 302 `Location: /login` 并返回 null
   （跳转而非 403/放行，满足验收）。可挂到任意路由；本任务将其挂到 FP-004 的
   三个受限占位路由 `/users` `/compose` `/timeline`（受限页清单），真实页面本体
   由 FP-010/012/014 提供后由联调替换内容区。
5. **/logout 即销毁动作**：携带有效凭据的 GET `/logout` → `destroySession(token)` +
   `Set-Cookie ... Max-Age=0` + 302 `/login`；无凭据 / 未知 token 幂等（仅跳转）。
   退出入口的页面呈现归 FP-008。
6. **组装可回退**：`createWebServer({ getCurrentUser, sessionAccess })` ——
   注入 `sessionAccess` 时：currentUser 取 `sessionAccess.currentUser`、
   受限三页挂守卫、`/logout` 变为销毁动作；未注入时保持 FP-004 基线
   （恒 null + 全路由占位可达），FP-004 既有用例零破坏。
   生产入口 `startServer()` 默认注入（内存 store + 种子），即 `./run start`
   即可验收「未登录访问受限页跳转登录页」。
7. **createSessionOnLogin 只承接「登录成功事件」**：`createSessionOnLogin(user_id)`
   → `{token, expires_at}`（token 为凭据本体，expires_at 供下发 Cookie 对齐 Max-Age）；
   用户名密码校验（FP-009）与登录页呈现（FP-008）不在本任务内。
8. **时间可注入**：store 构造参数 `now` / `ttlMs` 可注入，测试用假时钟确定性验证过期。

## 非范围提醒

登录校验（FP-009）、登录页 / 退出入口 UI（FP-008）、sessions 表持久化本身
（FP-001 契约，本任务按原语调用；Node 侧持久化桥接属集成点）、
各受限页本体（FP-010/012/014）。
