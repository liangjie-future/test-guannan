# 设计笔记 FP-012：发帖界面

## 目标

交付发帖 Web 界面：已登录用户在 `/compose` 输入纯文本并发布，提供实时字数提示
（当前 / 280）与失败原因提示（内容为空 / 超过 280 字），结果按 §3.2 三态呈现。

## 技术选型

- **运行层**：Node.js（≥18）+ 零第三方依赖，SSR 字符串模板挂载进 FP-004 统一布局
  （`renderPage(request, 内容区)`），与仓库既有 Web 层（FP-004 / FP-003 / FP-005）同栈。
- **测试**：`node:test`（`npm test` 自动发现 `tests/*.test.js`）。
- **理由**：任务卡语言无关；发帖界面是 Web 页面任务，复用既有布局/会话/服务器骨架
  最小增量；零依赖保持离线可验证。

## 模块结构

```
src/post-service.js   createPost 可注入端口 + 契约同形内存 Mock（§6）
src/compose.js        createComposePage({ createPost }) → { formHtml, submit }
src/server.js         /compose 路由集成：GET 表单 / POST 提交（登录门槛 + 405/413）
src/routes.js         移除 /compose 静态占位（改由 compose 实页承接）
tests/compose.test.js HTTP 层 + Mock 契约 + 登录门槛 + 输入健壮性用例
```

## 关键决策

1. **createPost 端口化 + 契约同形 Mock（§6）**：FP-013 实现产在 Python
   （`services.PostService`），Node Web 进程无法进程内调用。沿用 FP-003 消费
   FP-001 的既有模式（`src/session-store.js`）：`src/post-service.js` 按 §3.2
   契约形状提供内存 Mock——校验语义与 FP-013 严格对齐（去首尾空白后按**码点**计、
   上限 280 含边界、失败不落帖、`posts` 数组暴露作「帖子未发布」断言面）。
   跨语言桥接属集成点：替换注入的 `createPost` 即可，界面逻辑零改动。
   `startServer` 生产组装显式注入 Mock（与 sessionAccess 注入同风格）。
2. **登录门槛分层**：注入 `sessionAccess` 时 `/compose` 走 FP-003
   `requireLogin`（GET/POST 一致，匿名 302 `/login`，复用既有受限页守卫顺序）；
   未注入时保持 FP-004 基线（GET 匿名 200，H9 兼容），但 **POST 一律要求登录**
   ——匿名提交无论何种组装均 302 `/login` 且不触达发帖服务。
3. **字数口径（D3）统一为码点数**：`countCodePoints = Array.from(text).length`
   （代理对计 1，与 FP-013 Python `len()` 一致）。服务端渲染计数与浏览器内联
   计数脚本同口径；计数器结构 `当前 / 280`，`data-count` / `data-max` 暴露机器
   可断言面，超限时加 `is-over` 类。
4. **不设 `maxlength`**：textarea 不加 280 截断，保证 281 字输入可达（否则
   TOO_LONG 路径在 UI 上不可触发）；超限的最终裁决权在服务（FP-013）。
5. **三态结果呈现**：成功 → `data-result="OK"`「发布成功」反馈 + 已发布帖子
   摘要（转义）+ 空表单可继续发帖；失败 → `data-result="ERROR"`
   `data-reason="EMPTY_CONTENT|TOO_LONG"` 对应文案（内容为空 / 超过 280 字上限
   （当前 N 字）），**回显保留原输入**且计数器服务端预置为当前字数（无 JS 也可读），
   帖子未发布由 Mock `posts` 不增长保证。未知 reason 走通用兜底文案。
6. **实时字数提示机制**：随表单下发的内联 `<script>` 监听 textarea 的 `input`
   事件更新计数器（零依赖、无框架）；初始值由服务端按同一 `countCodePoints`
   预渲染，脚本加载后立即对齐一次。
7. **安全与健壮性**：所有用户输入回显（textarea / 成功摘要 / reason）一律
   `escapeHtml`（XSS）；POST 请求体上限 64KB（280 字纯文本远小于此），超出 413
   且不触达发帖服务；`/compose` 仅接受 GET/HEAD/POST，其余 405（`Allow:
   GET, POST`）；表单缺 `content` 字段视为空串 → EMPTY_CONTENT。
8. **范围隔离**：不做内容校验/保存（FP-013）、不做会话（FP-003，仅挂载其
   `requireLogin`）、不做布局（FP-004，仅内容区挂载）、不做时间线（FP-014/015）。

## 验收映射

| 验收标准 | 测试 |
| --- | --- |
| alice 打开发帖入口：输入 + 发布控件 + 字数提示（当前 / 280） | `tests/compose.test.js` C1 / C8 |
| 281 字提交 → 超长原因提示、帖子未发布 | C3（Mock `posts` 不增长） |
| 空 / 全空白提交 → 内容为空提示、帖子未发布 | C4 |
| ≤280 字发布 → 发布成功反馈 | C2（hello world）/ C5（恰 280） |
| 登录门槛（匿名不发帖） | G1 / G2 / G3 |
