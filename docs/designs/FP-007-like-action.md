# 设计笔记 FP-007：点赞与取消点赞动作

## 目标

新增 Web 动作路由 `POST /posts/<id>/like`：toggle 切换点赞 / 取消、重复操作幂等；写权限为时间线可见者（D4：登录即可写，不要求互关）；完成后经 PRG 回时间线。

## 技术选型

- **语言**：Node.js >=18 零依赖 SSR（任务卡 §2 系统上下文：动作路由属 Node Web 层）。
- **形态**：路径解析 + 规则服务 + 组装接线三段，风格逐项对齐仓库既有关注动作 `/users/<id>/follow`（`parseFollowActionPath` + `usersPage.handleFollowAction` + `server.js` 组装）。

## 关键决策

1. **新模块 `src/like-action.js`，只依赖 §3.2 契约形状（鸭子类型）**：
   - `parseLikeActionPath(pathname)`：`/posts/<id>/like` → 数字 id，其余 → null（命名与判定方式对齐 `parseFollowActionPath`）；
   - `createLikeActionService({ store })`：仅暴露 `toggleLike(postId, userId)`，只用 `likePost / unlikePost / getLikesByPostIds` 三方法。不 import FP-001 / FP-005 具体实现，替换注入零改动（Python SQLite 桥接属集成点）。
2. **toggle 判定口径**（任务卡 §3.2）：`getLikesByPostIds([postId])` 结果中存在 `user_id === viewer.id` → `unlikePost`；不存在 → `likePost`。幂等由两端共同保证：Node 侧判定 + 存原语幂等（FP-005 Set/Map、FP-001 唯一约束），重复 / 并发提交最终恰一条。
3. **组装模式对齐关注动作**：`createWebServer` 增 `likeStore = null` 注入位——未注入时该路由不可达（走 404 基线），与 `usersPage === null` 时关注动作不可达同模式；`startServer` 生产组装注入 `createMemoryInteractionStore()`（FP-005 已合入，§6「内联 Mock」无需再写，直接消费其契约实现）。
4. **守卫顺序复刻 `handleFollowAction`**：登录门槛先行（`requireLogin` 未登录写 302 /login 并终止，不触存储——故匿名任何方法都不产生点赞记录），其后才判 `POST`（否则 405 + `Allow: POST`）。匿名 + 非 POST 的组合落在登录分支（302 /login），与关注动作一致。
5. **PRG 用 302 Location /timeline**：任务卡 §4 明确「302 Location /timeline」（关注动作的 303 + notice 反馈是 FP-010 页面语义，本卡无结果提示需求，不引入 notice）。
6. **不做帖主 / 帖子存在性校验**（存储不设防，上游 D3 推导口径）：写权限＝登录即可；`/posts/999/like` 这类不存在帖由读取路径唯一过滤点（FP-004 / FP-009）兜底，动作层不重复定义语义。
7. **非范围**（§5）：按钮渲染与 toggle 态呈现（FP-006）、可见计数减一呈现（FP-004 / FP-006 联调）、可见性过滤（FP-004 / FP-009）、Python 持久化桥接（集成点）。

## 目录结构

```
src/
  like-action.js    # parseLikeActionPath + createLikeActionService（toggleLike）
  server.js         # createWebServer 增 likeStore 注入位 + handleLikeAction 分发；
                    # startServer 注入 createMemoryInteractionStore()
tests/
  like-action.test.js  # 对应 docs/test-cases/FP-007-like-action.md
docs/
  designs/FP-007-like-action.md
  test-cases/FP-007-like-action.md
```

## Mock 与种子策略（§6）

强依赖 FP-001（Python 存取）已合入、FP-005（Node 内存实现）已合入：测试与生产默认均直接注入 `createMemoryInteractionStore`（显式空 `likes: []` 种子得净空态；单条 `{post_id: 1, user_id: 1}` 种子得「已点赞」前置态）。会话用仓库既有 `createMemorySessionStore`（`seed-token-1` = alice(1)）+ `webUsers()`（bob(2) 入用户表，帖主自赞路由用例经 `createSessionOnLogin(2)` 建会话）。

## 验证

```bash
node --test tests/like-action.test.js   # 本任务
npm test                                # Node 全量回归
python3 -m pytest -q                    # Python 侧回归（不受影响）
```
