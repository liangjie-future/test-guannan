# 测试场景 FP-008：登录页与退出入口

对应验收标准（任务卡 §7）与独立验证方式（§8）。测试文件：
`tests/login-page.test.js`（渲染）、`tests/login-mock.test.js`（Mock 契约）、
`tests/login-flow.test.js`（HTTP 层全流程），运行 `npm test`。

前置：Mock login（§6 种子 bob / `right-password`，错误样例 `"bob"/"wrong-password"`、
`"ghost"/任意`）+ FP-003 sessionAccess（内存 store，用户表 alice + bob）；
HTTP 层经 `createWebServer({ sessionAccess, login })` 组装。

## 一、页面渲染（tests/login-page.test.js）

| # | 场景 | 期望 |
| --- | --- | --- |
| P1 | 默认（未登录打开登录页）内容区 | 含 `method="post" action="/login"` 表单、用户名输入（`type=text name=username`）、密码输入（`type=password name=password`）、提交控件（`type=submit`）；无错误提示块 |
| P2 | 失败态 `loginPageContent({ error })` | 表单保留（可重试）+ `data-testid="login-error"` 提示块展示 error 文案 |
| P3 | 提示文案经 HTML 转义（XSS 边界） | error 含 `<script>` 时输出转义实体，原文不出现 |

## 二、login Mock 契约（tests/login-mock.test.js）

| # | 场景 | 期望 |
| --- | --- | --- |
| M1 | `("bob", "right-password")` | 恰 `{status:"OK", user:{id,username}, session_token}` 三键；user 不含 password 等多余键；session_token 非空 |
| M2 | `("bob", "wrong-password")` 与 `("ghost", 任意)` | 一律 `{status:"ERROR", message:"用户名或密码错误"}`（恰两键，无 session_token） |
| M3 | 两失败场景响应不可区分 | dict 深相等（文案 / 键集 / 形态一致） |
| M4 | 非字符串输入（null / 数字组合） | 统一失败、不抛异常 |
| M5 | 自定义 accounts 注入 | 按注入账号表判定（可替换性） |
| M6 | 注入 createSessionOnLogin | 成功时恰调用一次（入参为账号 id）；token / `{token, expires_at}` 两形态均取 token |

## 三、HTTP 层登录 / 退出全流程（tests/login-flow.test.js）

| # | 场景 | 期望 |
| --- | --- | --- |
| L1 | 未登录 GET `/login` | 200 统一布局；两输入 + 提交控件；导航为未登录态（有登录 / 注册入口、无退出入口） |
| L2 | POST `/login`（bob / right-password，urlencoded） | 302 → `/timeline`；Set-Cookie `session_token=...`（HttpOnly / SameSite=Lax / Max-Age>0） |
| L3 | 携 L2 Cookie 访问 `/timeline` | 200（非 302 拦截）；导航显示 bob 与退出入口（已登录态贯通） |
| L4 | POST 错误密码（bob / wrong-password） | 200 回渲染登录页 + `data-testid="login-error"` 统一提示；无 Set-Cookie；store 会话数不增长 |
| L5 | POST 未知用户名（ghost / right-password） | 与 L4 文案逐字相同（两场景一致，不区分哪项错）；无 Set-Cookie、不建会话 |
| L6 | POST 空 / 缺字段（空用户名、空密码、空体） | 统一失败提示，不 500、不建会话 |
| L7 | 超大请求体（>64KB） | 413（上限保护），不建会话 |
| L8 | PUT `/login` 等其它方法 | 405，Allow 含 POST |
| L9 | 退出回路：登录后 GET `/logout`（携 Cookie） | 302 → `/login` + Set-Cookie Max-Age=0；store 内原 token 立即失效（getSession → null） |
| L10 | 退出后原 Cookie 再访问 `/timeline` / `/` | 受限页 302 → `/login`；首页导航回未登录态（无 bob、无退出入口） |
| L11 | FP-004 基线（未注入 sessionAccess，login 默认 Mock） | GET `/login` 200 真实表单；POST 成功 302 `/timeline`（无 Set-Cookie）；既有行为零破坏 |
| L12 | 生产组装（startServer 默认注入，bob 种子） | POST bob / right-password → 携 Cookie `/timeline` 200 且导航含 bob 与退出 |

## 四、既有回归

- `tests/server.test.js` S2 调整：`/login` 由占位内容升级为真实登录页，
  其余占位路由断言不变；FP-004/005/003 既有用例全部保持通过；
- `pytest`（FP-001/002/007/009/011/013/015）与 `npm test` 全量不回归。

## 运行

```bash
npm test    # Node 侧全量（含本任务三份测试）
pytest -q   # Python 侧回归
```
