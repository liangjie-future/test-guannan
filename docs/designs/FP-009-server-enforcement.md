# 设计笔记 FP-009：互动服务端强制过滤与鉴权兜底

> 来源任务卡：input/tasks/mutual-friend-interaction-visibility/FP-009-server-enforcement.task.md
> （本仓库另一拆解的 FP-009-login-verify 与本卡无关，文件名以 slug 区分。）

## 目标

把全部互动读取与写入路径置于登录守卫之后、可见性过滤固定在服务端数据
组装层；响应体不含任何被隐藏互动及其存在性痕迹（服务端兜底红线 D8）。

## 现状盘点（波 3 时点）

- **写入守卫已就位（FP-007 / FP-008 落地）**：`src/server.js` 中
  `POST /posts/<id>/like` 与 `POST /posts/<id>/comment` 均以路径模式
  （`parseLikeActionPath` / `parseCommentActionPath`）在静态路由表之前
  分发，处理前置 `requireActionLogin`（sessionAccess 模式＝
  `requireLogin` 302 /login；基线模式＝匿名亦 302），守卫先于 405 方法
  检查与任何存储触达。本任务补 HTTP 级回归用例锁定该红线（验收 2）。
- **读取路径缺口（本任务主实现点）**：/timeline（FP-014）只渲染帖子流，
  互动明细无任何服务端过滤组装层——补齐为唯一过滤数据源。

## 关键决策

1. **新增组装层模块 `src/timeline-interactions.js`**（形态对齐
   like-action / comment-action 的“规则层 + 注入”风格）：
   - 端口：`visibility.getVisibleInteractions(viewer_id, posts)`——
     FP-004 §3.2-1 冻结契约，Node 侧由 FP-005 内存 Mock 同形提供；
   - `assemble(viewer, posts)`：调用上述契约**一次**（批量、按帖对齐），
     在其输出上补齐渲染便利字段：`username`（经 `getUserById` 目录，
     缺失回落 `用户#<id>`，口径同 timeline.js 作者回落）、
     `viewer_liked`（`user_id === viewer.id`，供 FP-006 已赞态）；
   - **红线内建**：本模块不 import / 不调用 `getLikesByPostIds` /
     `getCommentsByPostIds`，互动明细唯一来源是可见性服务输出——
     “任何代码路径不得绕过过滤直取互动明细”由构造保证；
   - `renderFragments(viewer, posts)`：把 assemble 结果渲染为逐帖
     HTML 片段（Map<post_id, html>）。样式保持最小（FP-006 拥有终态
     呈现），只携带 data-testid / data-count 钩子与可见计数文本，
     供本任务 HTML 源级无泄露断言与 FP-006 联调。
2. **无泄露口径落到渲染**：计数＝可见数（`data-count` + 文案）、列表只
   含可见条目（正序，沿用服务排序）、无“还有 N 条”类占位、无隐藏量差、
   不渲染任何时序空洞标记；可见集为空 → 0 计数 + 空列表。
3. **注入链**：`createWebServer` 新增 `interactionVisibility` 选项
   （鸭子类型，仅需 `getVisibleInteractions`；默认 null → /timeline
   保持 FP-014 基线，向后兼容）→ `createRoutes({ interactionArea })` →
   `createTimelinePage({ interactionArea })`：`render(user)` 先取帖子流，
   再经 interactionArea 产出片段，逐帖内嵌进既有 `timeline-item`。
4. **FP-005 Mock 增补 `getUserById`**：内存 store 已持有用户表，补一个
   只读查找（返回副本）供组装层补 username；属 Mock 便利扩展，不触碰
   §3.2 冻结契约形状。组装层对 getUserById 缺失容错（可选端口）。
5. **startServer 生产组装收口**：点赞、评论写入与可见性服务统一共享
   同一 `createMemoryInteractionStore()` 实例（此前 comment 动作回落
   独立默认实例，写读分 store——FP-009 一并接线：
   `createComment: interactionStore.createComment` +
   `interactionVisibility: interactionStore`）。
6. **守卫复用而非重写**：动作与读取守卫均复用 `src/session-access.js`
   既有 `requireLogin`（302 /login），互动动作路径以路径模式纳入同等
   守卫（FP-007/FP-008 已实现，本任务以回归用例锁定“不产生互动记录”）。

## 验证策略

`tests/interaction-enforcement.test.js`（HTTP 级：createWebServer +
临时端口真实请求，风格对齐 tests/like-action.test.js）：
标准场景种子（alice/bob/carol/dave + 帖 P1 互动，FP-005 §6 同构）、
会话 seed-token-1=alice / dave token / seed-token-expired，用例映射
任务卡验收 1–5（详见 docs/test-cases/FP-009-server-enforcement.md）。
命令：`node --test tests/interaction-enforcement.test.js`。

## 非范围

可见性公式（FP-004）、动作业务语义（FP-007/FP-008）、互动区终态样式
（FP-006）——本任务只做守卫回归 + 组装收口。
