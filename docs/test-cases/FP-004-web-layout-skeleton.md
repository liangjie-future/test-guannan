# FP-004 Web 页面骨架与导航 — 测试场景

测试运行器：`node:test`（`npm test`）。
替身策略：`getCurrentUser` 注入替身——已登录返回 `{id:1, username:"alice"}`，未登录返回 `null`。

## 布局装配（tests/layout.test.js）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| L1 | renderPage 装配统一布局 | 输出完整 HTML 文档；含 `header.site-header` / `nav.site-nav` / `main.site-content` / `footer.site-footer`；内容区出现在 main 与 footer 之间；自定义 title 生效 |
| L2 | 未登录（null）五入口 | 导航含 `/register` `/login` `/users` `/compose` `/timeline` 五个 href |
| L3 | 已登录（alice）导航分支 | 含用户名标识 `alice`（`data-testid="current-username"`）、登录态「已登录」、退出入口 `/logout`；主导航三入口仍在 |
| L4 | 未登录（null）导航分支 | 含注册/登录入口；不含用户名标识、不含 `/logout`、不含「alice」、`data-login-state="anonymous"` |
| L5 | XSS 边界 | 替身用户名 `<script>alert(1)</script>` 被转义，页面无原始 `<script>` 注入 |
| L6 | 默认注入点 | 未注入 `getCurrentUser` 时按未登录渲染（FP-003 未合入基线） |

## HTTP 服务（tests/server.test.js）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| S1 | 演示页 `/` | 200；`Content-Type: text/html; charset=utf-8`；统一布局结构 + 演示内容 + 五入口 href |
| S2 | 五入口 + /logout 路由可达 | `/register` `/login` `/users` `/compose` `/timeline` `/logout` 均 200 且经统一布局（header+footer）装配，占位内容标注归属 FP |
| S3 | 已登录替身（HTTP 层） | `/` 响应含 alice、已登录、`/logout` |
| S4 | 未登录替身（HTTP 层） | `/` 响应含注册/登录入口，无用户名、无 `/logout` |
| S5 | 未知路径 | 404；仍经统一布局装配，提示页面未找到 |

## 注入点（tests/current-user.test.js）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| C1 | 默认 currentUser | 对任意请求返回 `null`（FP-003 未合入时的行为基线） |
