# 设计笔记 FP-008：评论提交动作

## 目标

新增 `POST /posts/<id>/comment` 评论动作路由：1–280 字非空纯文本（去首尾
空白、按码点计数、280 含边界），成功 `createComment` 落库并 PRG 302 回
时间线；失败不落库，302 携带失败原因与原输入回跳 `/timeline`。

## 技术选型

- **运行层**：Node.js（≥18）零依赖 SSR Web 层，与仓库既有动作路由
  （FP-010 `POST /users/<id>/follow`）同形态：模块出 `parseXxxActionPath` +
  处理器，`src/server.js` 路径分发。
- **测试**：`node --test tests/comment-action.test.js`（HTTP 层 + 单元层，
  Location 参数与 store 状态双断言）。
- **理由**：任务卡 §4 明确「命名对齐既有动作风格」；依赖的 FP-005 内存
  互动 store（`createComment` / `getCommentsByPostIds`）已合入，直接消费。

## 模块结构

```
src/comment-action.js   parseCommentActionPath + validateCommentContent +
                        commentFailureLocation + createCommentAction({ createComment })
src/server.js           /posts/<id>/comment 分发：登录守卫先行 → 委托处理器
                        （405 / 413 / 校验 / createComment / PRG）
tests/comment-action.test.js  单元 + HTTP 层用例（验收 1–5 对应 A 组）
```

## 关键决策

1. **createComment 端口注入，默认 FP-005 内存 store**：`createWebServer`
   新增 `createComment` 注入位；未注入时默认取
   `createMemoryInteractionStore().createComment`（FP-005 已合入，即
   「Node 侧存取实现提供方」，标准场景种子）。Python SQLite 持久化桥接属
   集成点：替换注入即收口，路由逻辑零改动（与 `createPost` 注入同模式）。
2. **校验口径复用发帖链路常量**（§3.2-2，上游 D7 冻结）：去首尾空白后
   非空 → 否则 `EMPTY_CONTENT`；`countCodePoints`（`Array.from(text).length`，
   代理对计 1）> 280 → `TOO_LONG`。直接 import `src/post-service.js` 的
   `MAX_POST_LENGTH` / `REASON_*` / `countCodePoints`，单一事实源。
3. **落库内容为去首尾空白后的文本**：与仓库既有链路一致
   （`services/posting.py`、`services/engagement.py` 均 `strip()` 后写入，
   `createMockPostService` 同）；**失败回跳携带原输入**（未 trim），
   供 FP-006 互动区回显（输入保留的数据源）。
4. **失败回显参数协议（§3.2-4，与 FP-006 共同冻结）**：302
   `/timeline?comment_failed_post=<postId>&comment_error=EMPTY_CONTENT|TOO_LONG&
   comment_text=<URL 编码原输入>`，用 `URLSearchParams` 按该顺序拼接
   （空格编码为 `+`，`searchParams.get` 可无损还原）；成功 302 `/timeline`
   （PRG；评论区末尾呈现由读取方 created_at 正序保证）。任务卡冻结 302
   （非 follow 动作的 303）。
5. **守卫与方法判定顺序**（对齐 `handleFollowAction`）：登录守卫先行——
   注入 `sessionAccess` 时 `requireLogin`（未登录 302 `/login`，无评论
   记录）；未注入时 `getCurrentUser` 判空，匿名一律 302 `/login`
   （POST 动作不放行，与 /compose 同策略）。已登录后非 POST →
   405（`Allow: POST`）。
6. **健壮性**：复用 `readFormBody`（64KB 上限，超出 413 不触达 store）；
   缺 `content` 字段归一为空串 → `EMPTY_CONTENT`（不 500）；表单读取
   异常按 `err.statusCode ?? 400` 文本响应。
7. **范围隔离**：不提供回复 / 嵌套 / 编辑 / 删除路径（上游 D7）；不做
   输入框与失败文案呈现（FP-006 按回显参数渲染）、不做可见性过滤
   （FP-004 / FP-009）；非 `/posts/<数字>/comment` 形状的路径不分发，
   落回既有 404。

## 验收映射

| 验收标准 | 测试 |
| --- | --- |
| alice 登录 POST content=hello → 落库（末位 / 恰一条）+ 302 /timeline | A1 |
| 281 字 → 无记录 + Location 携带 TOO_LONG 与原输入 | A2 |
| 全空白 → 无记录 + EMPTY_CONTENT 与原输入 | A3 |
| 未登录 → 302 /login，无记录 | A4 |
| 去空白后恰 280 字 → 成功落库（280 含边界） | A5 |
