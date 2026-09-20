# FP-006 注册页 — 设计说明

## 目标

交付注册页 `/register`：访客填写用户名、密码提交注册，调用 register 服务（§3.2 契约），
成功展示成功结果并体现已进入登录态，失败展示对应原因文案（用户名已存在 / 密码过短），
失败态不产生任何「已注册」视觉暗示。

## 技术选型

- Node.js（≥18）+ 零第三方依赖：与 FP-004 布局骨架 / FP-003 会话访问控制同栈
  （Web 层均为 Node），`node:http` + `node:test`，SSR 字符串模板。
- 理由：注册页属界面与交互层，须挂载进 FP-004 `renderPage` 统一布局；
  保持零依赖使 `npm test` 离线可验证。

## 模块结构

```
src/register-service.js  §6 可注入 Mock：createMockRegisterService({ createSessionOnLogin })
src/register-page.js     renderRegisterForm({error, username}) 内容区 + createRegisterPage
                         ({ registerService }).handlePost(request, response, { layout })
src/server.js            GET/POST /register 接线；startServer 生产组装（Mock + 会话桥接）
src/routes.js            移除 /register 占位（由真实页面替代）
tests/register-page.test.js  渲染 + 三态提交 + 登录态贯通 + 边界用例
```

## 关键决策

1. **register 服务注入（§3.2 契约形状）**：页面只依赖
   `register(username, password) → {status: OK, user, session_token} |
   {status: ERROR, reason: USERNAME_TAKEN | PASSWORD_TOO_SHORT}`；
   默认绑定 §6 有状态 Mock（初始为空，按 FP-007 同序规则：用户名占用 → 密码 ≥6 位），
   验证种子即任务卡样例：`alice`/`secret123` 首次 OK、再次 USERNAME_TAKEN、
   `newuser`/`12345` PASSWORD_TOO_SHORT。真实建号（FP-007，Python 侧）联调时整体替换注入。
2. **成功 = 登录态承接**：OK 后以 `Set-Cookie: session_token=...`（HttpOnly、
   SameSite=Lax、Path=/、Max-Age 7 天，对齐 FP-003 TTL）下发服务返回的会话凭据，
   302 跳转 `/timeline`（PRG 防重复提交）。生产组装（`startServer`）将 Mock 的
   `createSessionOnLogin` 桥接到 FP-003 `sessionAccess`，凭据即被会话存储识别，
   跳转后导航直接呈现用户名标识与「已登录」。
3. **失败 = 重渲染表单 + 原因文案**：ERROR 态 200 重渲染表单，错误横幅
   （`data-testid="register-error"`）按 reason 映射文案「用户名已存在」「密码过短」；
   未知 reason 兜底「注册失败，请稍后重试」。文案只做映射、不内嵌规则细节
   （长度阈值属 FP-007），避免规则双写。失败响应无成功标记、无 Set-Cookie、
   不创建账号（Mock 状态不变），表单控件保留可重试。
4. **页面侧仅做输入完备性守卫**：用户名 / 密码缺失（含空串、乱码体解析为空）时
   直接提示「请填写用户名和密码」，不触达服务（可注入计数断言）；
   用户名 trim 后回显（经 `escapeHtml`，防反射 XSS），密码不回显。
5. **健壮性边界**：请求体上限 64KB（超限 413）；服务抛异常 500（无成功暗示）；
   POST 仅 `/register` 放行，其余路由维持 FP-004 的 405 基线
   （`/register` 的 Allow 为 `GET, POST`）。
6. **布局兼容**：内容区字符串挂载进 `renderPage`（弱依赖 FP-004 已合入即用；
   未注入布局时页面模块不直接渲染整页，测试经 server 装配验证）。

## 验收映射

| 验收标准 | 测试 |
| --- | --- |
| 渲染呈现用户名 / 密码输入与提交控件 | `tests/register-page.test.js` R1 |
| USERNAME_TAKEN → 「用户名已存在」，账号未创建 | R3（含 Mock 状态断言） |
| PASSWORD_TOO_SHORT → 密码过短，账号未创建 | R4 |
| OK → 成功结果 + 已进入登录态 | R2（302 + Cookie）、R5/R10（时间线已登录态贯通） |
| 失败无成功视觉暗示 | R3 / R4 / R6–R9 的无 `register-success` / 无 Set-Cookie 断言 |
