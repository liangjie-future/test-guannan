# 测试场景 FP-002：评论数据表与存取原语

对应验收标准（任务卡 §7）与独立验证方式（§8）。测试文件：
`tests/test_comments.py`，运行 `pytest tests/test_comments.py`。

种子口径（§6）：alice(1) / bob(2) / carol(3)；帖 P1（bob）；时序场景以
直接 SQL 插入指定 `created_at` 构造（T1 < T2 < T3，TE = T3 同时刻）。

## TC-01 建库后 comments 表契约（验收 1）

- **前置**：空库（临时目录新 SQLite 文件）。
- **步骤**：`DataStore(path)` 初始化后查 `PRAGMA table_info(comments)`、
  `PRAGMA foreign_key_list(comments)`、`sqlite_master` 索引。
- **期望**：
  - 字段恰为 `id / post_id / user_id / content / created_at`；
  - `id` 为主键且自增（`pk=1`、`rowid` 回落 AUTOINCREMENT）；
  - `post_id → posts(id)`、`user_id → users(id)` 两条外键；
  - 索引 `idx_comments_post_id` 存在（命名索引风格对齐 `idx_posts_author_id`）；
  - 二次打开同文件幂等不报错（`CREATE TABLE IF NOT EXISTS`）。

## TC-02 createComment 写入与读回（验收 2）

- **前置**：种子（alice / bob / carol + P1）。
- **步骤**：`createComment(P1, alice, "hello")`。
- **期望**：返回 `{id, post_id, user_id, content, created_at}` 恰五字段，
  `post_id / user_id / content` 与入参一致，`created_at` 为合法时间，
  `id` 为正整数；`getCommentsByPostIds([P1])` 恰含该条记录；
  多次创建 `id` 递增互异。

## TC-03 按 created_at 正序、同时刻按 id 升序（验收 3）

- **前置**：P1 下直插多条评论：alice@T1、carol@T2、bob@T3（id 乱序直插，
  如先插 T3 再插 T1），另两条同时刻 TE=T3（id 相邻先后插入）。
- **步骤**：`getCommentsByPostIds([P1])`。
- **期望**：按 `created_at` 早→晚排列（T1 → T2 → T3/TE），同时刻两条按
  `id` 升序；集合完备（恰 5 条）。

## TC-04 同用户同帖多次评论全部保留（验收 4）

- **前置**：P1；alice 先后写 3 条评论。
- **步骤**：`getCommentsByPostIds([P1])`。
- **期望**：3 条全部返回（无唯一约束去重），content 逐条一致，顺序按
  写入时间正序。

## TC-05 集合查询边界

- 空入参 `[]` → `[]`（不发 SQL 短路）；
- 入参含重复（`[P1, P1, P1]`）→ 每条评论恰出现一次（去重）；
- 多帖聚合：P1、P2 各有评论 → `getCommentsByPostIds([P1, P2])` 返回
  两帖全集且全局按 `(created_at, id)` 正序、不混入他帖；
- 混合不存在的帖 id → 仅返回存在帖的评论，不报错。

## TC-06 存储层不做内容校验（§4，对齐 createPost 先例）

- 超 280 字（码点计）、含空白 / 换行 / Unicode 的内容均原样存取；
  1–280 规则归上层（FP-016 已在服务层实现，本层不拦截）。

## TC-07 持久化

- `createComment` 写入后 `close()` 重开（等价重启），评论完整可读回。
