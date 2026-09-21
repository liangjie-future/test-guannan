# FP-014 时间线页面 — 设计说明

## 目标

交付时间线页面（登录后首页）：聚合呈现全部被关注对象的帖子（作者 / 内容 / 发布时间），
未关注任何人时展示空态提示并引导去用户列表。聚合与排序语义由 FP-015 `getTimeline`
承担（本页面不重排）；登录门槛由 FP-003 `requireLogin` 承担。

## 技术选型

- 沿用 FP-004 Web 层栈：Node.js（≥18）+ 零第三方依赖，`node:http` + 服务端字符串模板
  SSR，`node:test` 测试运行器。时间线页面以内容区字符串挂载进 `renderPage` 统一布局。

## 模块结构

```
src/timeline.js    时间线页面模块：
                    createTimelinePage({ getTimeline }) → { render(user), renderAnonymous() }
                    renderTimelinePosts(posts)  帖子流条目渲染（纯函数）
                    renderTimelineEmptyState()  空态提示
                    createMockGetTimeline({ scenario })  §6 可注入 Mock（场景 A/B）
src/routes.js      路由表改为工厂 createRoutes({ getTimeline })：/timeline 由静态占位
                    改为 render({ user }) 动态内容；其余路由不变
src/server.js      createWebServer({ getCurrentUser, sessionAccess, getTimeline })：
                    支持带 render 的路由；/ 已登录 → 302 /timeline（默认落点）；
                    startServer 生产组装默认注入 Mock 场景 A（FP-015 跨语言桥接前的占位）
```

## 关键决策

1. **顺序责任分离（验收核心）**：页面按 `getTimeline` 返回顺序原样渲染，不排序、不过滤
   （`<ol>` 语义即展示序）。倒序 / 仅被关注者范围由 FP-015 保证；页面仅做展示与转义。
2. **依赖注入（§6 Mock 策略）**：`getTimeline(user_id)` 为构造注入。FP-015 实现产在
   Python（跨语言），Node Web 进程无法进程内调用，默认以 `createMockGetTimeline()`
   场景 A（B、C 各 2 帖、时间交错、已倒序）占位，场景 B（空集合）供空态验证；
   联调时替换注入即可，页面逻辑零改动。
3. **登录门槛（挂载 FP-003）**：`/timeline` 已在 `RESTRICTED_PATHS`，`sessionAccess`
   注入即受 `requireLogin` 守卫（未登录 302 `/login`）。守卫放行后以返回的
   `{id, username}` 作为 `getTimeline(user.id)` 的查询主体。
4. **默认落点**：`/` 按登录态分流——已登录 302 `/timeline`（时间线即登录后首页）；
   未登录保持 FP-004 演示页（基线行为不回归）。
5. **匿名直访防御（FP-004 基线模式）**：未注入 `sessionAccess` 时 `/timeline` 无守卫
   （FP-004 契约：占位可达），页面渲染「登录后查看」引导而非空态（空态语义属登录用户）。
6. **条目渲染**：每条含作者（`author_username`，缺失时回退 `用户#<author_id>`，对齐
   FP-015 防御口径）、内容、发布时间（`<time datetime="ISO">` + 展示文本，ISO 的 `T`
   换空格、去尾部 `Z`）；所有动态值经 `escapeHtml` 转义。
7. **空态提示**：`还没有关注任何人` + 引导链接 `去用户列表`（`/users`，FP-010 入口）。

## 验收映射

| 验收标准 | 测试 |
| --- | --- |
| Mock 场景 A：B/C 全部帖子倒序呈现、字段齐全、无他人帖子、顺序与服务一致 | `tests/timeline.test.js`（T1/T2/T4）、`tests/timeline-page.test.js`（HTTP 层） |
| Mock 场景 B：空集合 → 空态提示 | `tests/timeline.test.js`（T3）、`tests/timeline-page.test.js` |
| 未登录经 requireLogin 跳转登录页 | `tests/timeline-page.test.js`（复用 FP-003 守卫装配） |
