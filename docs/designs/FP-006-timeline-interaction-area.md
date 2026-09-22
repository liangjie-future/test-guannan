# FP-006 时间线内嵌受限互动区 — 设计说明

## 目标

时间线每帖（`timeline-item`）下方渲染受限互动区：点赞按钮（toggle 态）、可见点赞
集合、仅可见计数（赞 / 评各一）、评论正序列表、评论输入框与实时字数提示；空态只给
0 计数、无任何占位或「部分已隐藏」类提示；好友与非好友帖主同一呈现路径。

## 技术选型

- 沿用仓库 Web 层栈：Node.js（≥18）零依赖，字符串模板 SSR，`node:test`。
- 渲染层只消费过滤后载荷：可见性 / 顺序完全由 `getVisibleInteractions`
  （§3.2-1 契约）保证，页面不过滤、不排序（上游 D1/D2/D8 的责任分离）。

## 模块结构

```
src/interaction-area.js  新增互动区模块（纯渲染 + §6 Mock）：
                         renderInteractionArea(post, payload, commentFailure)
                           单帖互动区 HTML（点赞表单 / 点赞集合 / 计数 /
                           评论列表 / 评论表单 + 字数提示）
                         parseCommentFailure(searchParams)
                           §3.2-3 回显参数 → { postId, reason, text } | null
                         commentFailureMessage(reason, text)
                           失败文案（EMPTY_CONTENT / TOO_LONG，口径同发帖链路）
                         createMockGetVisibleInteractions({ seeds… })
                           §6 Mock：FP-005 内存 store 组装 §3.2-1 载荷
                           （补 username / viewer_liked 渲染便利字段）
src/timeline.js          createTimelinePage 增注 getVisibleInteractions（默认
                         §6 Mock）；render(user, { searchParams }) 携失败回显；
                         renderTimelinePosts 增互动区挂载（未提供时保持 FP-014
                         纯帖子渲染，向后兼容）
src/routes.js            /timeline render 透传 url（searchParams 来源）
src/server.js            route.render({ request, user, url })；createWebServer
                         增 getVisibleInteractions 注入点（透传 routes）
```

## 关键决策

1. **只渲染不判定**：互动区逐元素对应 §3.2-1 载荷字段——`viewer_liked` 驱动
   `data-like-state="liked"|"not-liked"`；likes / comments 按服务返回顺序（正序）
   原样渲染；计数只读 `visible_like_count` / `visible_comment_count`。缺载荷的帖
   防御性回退空态（0/0、not-liked），不崩溃。
2. **data-testid 体系**（HTML 源码断言依据）：`interaction-area`（含
   `data-post-id`）、`like-form` / `like-button`（`data-like-state`）、
   `visible-likes` / `visible-like-user`、`visible-like-count` /
   `visible-comment-count`、`comment-list` / `comment-item`（含
   `comment-author` / `comment-content` / `comment-time`）、`comment-form` /
   `comment-input`（`name="content"`）/ `char-counter` / `comment-submit`、
   失败位 `comment-feedback`（`data-reason`）。评论时间用 `<span>`（不用
   `<time>`）——避免污染 FP-014 既有 `<time datetime>` 顺序断言。
3. **动作端点占位隔离（§4/§5）**：表单只渲染 `action="/posts/<id>/like"`、
   `action="/posts/<id>/comment"`（FP-007/FP-008 已实现接收端；即使未合入也不
   影响本卡渲染验收）。
4. **失败回显（§3.2-3，与 FP-008 冻结协议）**：`parseCommentFailure` 只认
   `comment_failed_post` + `comment_error ∈ {EMPTY_CONTENT, TOO_LONG}`；文案
   口径对齐 compose.js / services/posting.py（空 / 超限两态，N 为去首尾空白后
   码点数）；`comment_text` 仅回显到目标帖输入框并联动初始计数，其余帖不受
   影响。searchParams 由 server → routes → `render(user, { searchParams })`
   显式传递（不重复解析 request）。
5. **字数提示风格对齐 compose.js**：每互动区一个 `char-counter`
   （`data-max="280"`、初始 `data-count` = 回显文本码点数、文案「N / 280」），
   页尾一段脚本按 `interaction-area` 作用域批量绑定 input 监听（码点口径
   `Array.from(value).length`，与 `countCodePoints` 一致）；不设 maxlength，
   超限可达。
6. **空态与统一路径**：可见互动为空 → 计数位「0 赞 / 0 评论」，点赞集合与评论
   列表容器保留但无条目、无占位文案、无隐藏提示；好友 / 非好友帖主走同一
   `renderInteractionArea`，产物结构逐 testid 同构（验收 4 以结构断言）。
7. **§6 Mock 组装层**：`createMockGetVisibleInteractions` 内建 FP-005 内存
   store（种子与 FP-004/FP-005 同构：alice/bob/carol/dave、互关边、P1 上
   carol 点赞评论可见 / dave 隐藏 / bob 自互动排除），在其输出上补
   `username` 与 `viewer_liked`（= likes 含查看者，D5 恒可见故必然可见）——
   即 §3.2-1 所述「数据组装方补齐渲染便利字段」的默认实现。P2 备
   viewer_liked=true 态、P3/P4 空态；种子可注入替换（显式空数组即空态）。
8. **注入链不破坏既有行为**：`createTimelinePage` 未注入 getVisibleInteractions
   时默认 §6 Mock（时间线演示即含互动区）；`renderTimelinePosts(posts)` 纯调用
   保持 FP-014 原样输出（既有 T1–T8 / H 系列回归零改动）。

## 验收映射

| 验收标准 | 测试 |
| --- | --- |
| 1 可见点赞 / 评论 / 计数 / 正序 | `tests/timeline-interactions.test.js` A1/A2 |
| 2 toggle 两态（data-like-state） | A3 |
| 3 空态无占位无隐藏提示 | A4 |
| 4 非好友帖主同路径 | A5 |
| 5 失败文案 + 原文回显（HTTP 层） | A6/A7（+单元 A6b） |
| 6 全量正序不分页 | A8 |

运行：`node --test tests/timeline-interactions.test.js`；全量 `npm test` +
`python3 -m pytest -q`（Python 侧不受本任务影响，仅回归）。
