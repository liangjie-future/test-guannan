# 设计笔记 FP-008：登录页与退出入口

## 目标

交付登录页（用户名 / 密码输入 + 提交，失败展示统一错误提示）与导航退出入口
（已登录可见，点击后销毁会话回到未登录态 / 登录页）。页面只收集输入、调用
登录服务、呈现结果与退出点击；不实现校验、会话、布局本体。

## 技术选型与整体形态

- **Node.js（≥18）+ 零第三方依赖**，与 Web 侧既有任务（FP-004/005/003）同栈：
  `node:http` 请求 / 响应为载体，`node:test` 验证，表单走原生
  `application/x-www-form-urlencoded` 提交（无前端 JS，逐步增强不可用时也完整可用）。
- 复用已合入的强依赖产物：FP-004 `createLayout().renderPage`（统一布局 + 按登录态
  渲染导航，弱依赖已合入故无需临时布局）；FP-003 `createSessionAccess`
  （currentUser / logout / createSessionOnLogin / sessionCookie / clearSessionCookie）。

## 模块结构

```
src/login-page.js    登录页内容区渲染：loginPageContent({ error }) → 表单 HTML
                     （error 非空时插入统一提示块，文案来自服务返回 message）
src/login-mock.js    §6 可注入 login Mock：createMockLoginService({ accounts })
                     → login(username, password)，种子 bob / right-password 两态
src/form-body.js     readFormBody(request, { limitBytes })：读流 + 上限保护 +
                     URLSearchParams 解析（缺字段归一为空串）
src/routes.js        /login 占位内容替换为真实登录表单（GET 渲染源）
src/server.js        组装点：createWebServer({ sessionAccess, login }) 增加
                     POST /login（成功建会话下发 Cookie 302 /timeline，失败 200
                     回渲染统一提示）；startServer 以 alice+bob 用户表组装，
                     ./run start 即可以 bob 登录验收
tests/login-page.test.js   页面渲染单测（控件 / 提示 / 转义）
tests/login-mock.test.js   Mock 契约形状单测（OK / 统一失败两态）
tests/login-flow.test.js   HTTP 层全流程（表单 / 成功 / 两失败场景 / 退出回路）
```

## 关键决策

1. **login 依赖按 §3.2 契约注入，默认 Mock**：FP-009 产在 Python（`LoginService`），
   Node Web 进程无法进程内调用——与 FP-003 决策 1 / FP-009 决策 4 同一跨语言口径。
   `createWebServer({ login })` 以函数注入，默认绑定 §6 Mock（种子账号
   bob / `right-password`；任意错误组合返回 `{status: "ERROR", message: "用户名或密码错误"}`，
   与 FP-009 `LOGIN_ERROR_MESSAGE` 文案一致）；真实桥接属集成点，替换注入即可，
   页面 / 流程逻辑零改动。
2. **会话建立走 FP-003 能力，页面不实现会话逻辑**：POST /login 成功后由组装点调用
   `sessionAccess.createSessionOnLogin(result.user.id)` → `{token, expires_at}`，
   再以 `sessionAccess.sessionCookie(...)` 下发（HttpOnly / SameSite=Lax / Max-Age
   对齐）。Mock 自身不建会话，其返回的 `session_token` 仅保契约形状；真实 FP-009
   桥接时将其 `createSessionOnLogin` 指向同一 store 即可（集成点）。
3. **失败统一提示由服务侧给定，页面只呈现**：错误文案取 `result.message`（契约
   §3.2：统一提示、不区分哪项错），页面经 `escapeHtml` 转义后插入
   `data-testid="login-error"` 块；缺 message 时回退同文案常量。错误页 200 回渲染
   （保留输入控件，可重试），不 302、不区分场景。
4. **成功跳转 /timeline**（登录态主页；受限页守卫反向验证登录态成立）。失败不
   下发任何 Set-Cookie、不建会话（结构上 createSessionOnLogin 仅在 OK 分支触达）。
5. **退出入口复用既有产物，本任务补齐端到端回路**：导航「退出」链接与
   GET /logout 销毁动作（destroySession + Max-Age=0 + 302 /login）已由 FP-004 /
   FP-003 提供；本任务以登录页产出的真实会话验证完整回路（登录 → 导航见退出 →
   点击 → token 失效 → 未登录导航态），并以 bob 替身覆盖验收 §7 第三条。
6. **生产组装补 bob 用户记录**：`startServer` 的内存 session store 用户表在
   FP-003 种子 alice 之上增加 bob（id=2，占位散列字段仅保形状）——否则 Mock 登录
   成功后 `currentUser → getUserById(2)` 解析不到用户，登录态无法贯通。为此将
   `seedUsers` 从 session-store.js 导出（向后兼容扩展）。
7. **表单体读取做上限保护**：`readFormBody` 超过 64KB 即停止缓冲、仅排空流，
   读完以 413 拒绝（连接语义完整；用户名 / 密码远小于该量级）；解析后缺字段
   归一空串 → 走统一失败路径，不 500。
8. **方法矩阵**：GET/HEAD /login 渲染表单（HEAD 不写体）；POST /login 处理提交；
   其余方法 405（Allow 含 POST）。未注入 sessionAccess 的 FP-004 基线保持
   GET 占位可达语义（/login 为真实表单），POST 成功仅 302 不带 Cookie。
9. **输入不回填**：失败重渲染不回显用户名（避免二次转义面），错误块为唯一状态。

## 非范围提醒

登录校验与散列比对（FP-009，以 Mock 隔离）；会话建立 / 销毁逻辑本体（FP-003，
本任务只调用）；统一布局骨架（FP-004，已合入直接复用）；注册页入口页面
（FP-006，仅经导航 / 登录页文案可达）。
