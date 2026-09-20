# FP-004 Web 页面骨架与导航 — 设计说明

## 目标

交付统一 Web 页面布局与导航（注册 / 登录 / 用户列表 / 发帖 / 时间线五入口），按登录态展示信息，
自带演示页 `/` 验证布局装配，作为后续全部功能页面的装配骨架。

## 技术选型

- Node.js（≥20）+ 零第三方依赖：`node:http` 提供 Web 服务，`node:test` 作为测试运行器，
  服务端字符串模板渲染 HTML（SSR）。
- 理由：任务卡语言无关；零依赖意味着 `npm test` / `npm start` 可直接离线验证，无安装风险。

## 模块结构

```
package.json          type=module；scripts: start / test
src/html.js           escapeHtml 工具（XSS 防护）
src/current-user.js   currentUser 注入点默认实现（FP-003 未合入 → 恒返回 null）
src/layout.js         createLayout({ getCurrentUser }) → renderPage(request, content, { title })
src/routes.js         路由表：/ 演示页 + 五入口占位页 + /logout 占位
src/server.js         createWebServer({ getCurrentUser }) → http.Server（404 亦走统一布局）
src/index.js          启动入口（PORT 环境变量，默认 3000）
tests/                node:test 用例（layout / server / current-user）
```

## 关键决策

1. **页面装配契约（共享契约）**：`renderPage(request, 内容区) → 完整页面`，
   结构为 页头导航 `<header>` + 内容区 `<main>` + 页脚 `<footer>`。各功能页（FP-006/008/010/012/014）
   后续以内容区字符串挂载，无需感知布局。
2. **导航两段式**：
   - 主导航恒显示：时间线 `/timeline` ｜ 用户列表 `/users` ｜ 发帖 `/compose`；
   - 认证区按登录态分支（`data-login-state` 属性暴露状态便于联调断言）：
     - 已登录（currentUser 非 null）：用户名标识（`data-testid="current-username"`）+ 登录态「已登录」+ 退出入口 `/logout`；
     - 未登录（null）：注册 `/register` + 登录 `/login` 入口；不渲染用户名与退出入口。
   - 五个入口对应路由在任何登录态下均可达（占位页挂载进布局），验收的「五入口可达」由
     未登录态导航（五链接齐全）+ 全路由 200 共同保证。
3. **currentUser 注入点**：构造注入（`createLayout` / `createWebServer` 均可注入）；
   默认实现恒返回 null（FP-003 未合入时的 Mock 基线）；测试替身返回
   `{id:1, username:"alice"}`（已登录）与 `null`（未登录）。
4. **占位页策略**：五入口与 `/logout` 的页面本体属 FP-006/008/010/012/014/FP-003，
   本任务仅提供标注归属的占位内容区用于验证装配与导航可达。
5. **安全**：用户名、标题、路径等动态值一律经 `escapeHtml` 转义。
6. **一致性**：未知路径返回 404 页，同样经统一布局装配。

## 验收映射

| 验收标准 | 测试 |
| --- | --- |
| 演示页使用统一布局，五入口可达 | `tests/layout.test.js`（布局结构与五入口）、`tests/server.test.js`（`/` 200 + 五 href） |
| alice 替身：用户名标识 + 登录态 + 退出入口 | `tests/layout.test.js`、`tests/server.test.js`（HTTP 层） |
| null 替身：注册/登录入口，无用户名与退出 | `tests/layout.test.js`、`tests/server.test.js`（HTTP 层） |
