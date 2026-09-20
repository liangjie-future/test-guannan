# FP-006 注册页 — 测试场景

依据任务卡 §7 验收标准与 §8 独立验证方式（HTTP 层渲染 + 提交流断言，`node --test`）。
被测对象：`createWebServer`（GET/POST `/register`）+ 可注入 register 服务（§6 Mock / 桩）。

## 渲染

- **R1 表单渲染**：GET `/register` → 200、`text/html`、统一布局（site-header/site-content）；
  含 `name=username` 输入、`name=password` 且 `type=password` 输入、`type=submit` 提交控件；
  `method="post"` + `action="/register"`；初始无错误横幅、无任何成功标记。
  HEAD `/register` → 200 空体。

## 三态提交流（§6 种子样例）

- **R2 OK 态（`alice`/`secret123`）**：Mock 初始为空 → POST → 302 `Location: /timeline`；
  `Set-Cookie` 含 `session_token`（HttpOnly、SameSite=Lax）；Mock 已收录 `alice`。
- **R3 已存在态（`alice`/任意）**：先成功注册 `alice`，再次 POST `alice`/任意 → 200
  错误横幅含「用户名已存在」；表单控件保留（可重试）；**无 Set-Cookie、无成功标记**；
  Mock 用户数不变（账号未创建）。
- **R4 过短态（`newuser`/`12345`）**：错误横幅含「密码过短」；无 Set-Cookie、无成功标记；
  Mock 未收录 `newuser`（账号未创建）。

## 登录态贯通（成功即视为已登录）

- **R5 会话桥接**：Mock 的 `createSessionOnLogin` 桥接 FP-003 内存会话存储 →
  POST OK 后携带返回 Cookie 访问 `/timeline` → 200、`data-login-state="logged-in"`、
  `current-username` 呈现注册用户名（非 302 跳登录页）。
- **R10 生产组装（`startServer`）**：POST 注册成功 → 携 Cookie 访问 `/timeline`
  → 已登录态 + 用户名标识。

## 边界与错误处理

- **R6 字段缺失**：用户名为空 / 密码为空 / 乱码请求体（解析为空）→ 200 提示
  「请填写用户名和密码」；注入计数桩断言服务未被调用（无注册副作用）。
- **R7 回显转义（反射 XSS）**：用户名 `<script>alert("x")</script>` + 短密码 →
  失败重渲染的 `value` 中原文被转义（页面不含裸 `<script>`）。
- **R8 未知 reason**：服务返回 `{status: ERROR, reason: "SOMETHING_ELSE"}` →
  兜底文案「注册失败，请稍后重试」，不崩溃、无成功标记。
- **R9 服务异常**：`register` 抛错 → 500 纯文本，无成功暗示。
- **R11 方法与基线兼容**：非 `/register` 路由 POST 仍 405；`/register` 的 405 Allow
  含 POST；FP-004 占位清单不再含 `/register`（由真实页面替代）。

## 断言口径（失败态无成功暗示）

失败响应统一断言：不含 `data-testid="register-success"`、不含「注册成功」、
无 `set-cookie` 响应头；Mock / 计数桩状态不变（不建号）。
