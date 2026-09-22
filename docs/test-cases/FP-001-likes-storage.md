# 测试场景 FP-001：点赞数据表与存取原语（likes-storage）

> 对应设计：docs/designs/FP-001-likes-storage.md；实现：storage/store.py；
> 测试：tests/test_likes.py（真实 SQLite 临时文件，接口断言 + 直查 SQL 双口径，
> 风格对齐 tests/test_follow.py）。
> 种子（任务卡 §6）：createUser 建 alice(id=1) / bob(id=2) / carol(id=3)；
> createPost 建 P1（bob）、P2（carol）；点赞记录经 likePost 写入。

## TC-01 建库即建表（验收 1：结构 / 约束 / 索引）

- **Given** 空库（DataStore 指向临时文件首次构造）**When** 建库
  **Then** likes 表存在。
- `PRAGMA table_info(likes)`：恰 post_id / user_id / created_at 三列，
  类型 INTEGER / INTEGER / TEXT，均 NOT NULL；post_id pk=1、user_id pk=2
  ——(post_id, user_id) 复合主键唯一约束。
- `PRAGMA foreign_key_list(likes)`：两条外键——post_id → posts(id)、
  user_id → users(id)。
- `PRAGMA index_list(likes)`：`idx_likes_post_id`、`idx_likes_user_id`
  两个命名索引齐备（建表与索引风格对齐既有 posts / follows）。

## TC-02 likePost 幂等（验收 2）

- **Given** 种子 alice + 帖 P1 **When** 连续两次 `likePost(P1, alice)`
  **Then** 两次均不抛错，直查 SQL `COUNT(*)=1`（恰一条）。
- 变体：三连点仍 1 条；与既有点赞（bob 已赞 P1）互不干扰，
  `COUNT=2` 且两行 (post_id, user_id) 各不相同。

## TC-03 unlikePost 删行幂等（验收 3）

- **Given** alice 已点赞 P1 **When** `unlikePost(P1, alice)`
  **Then** 该行删除（直查 COUNT=0）。
- 变体：对已删除 / 从未存在的记录再次取消不报错（幂等）；
  取消只删目标行，不影响同帖他人点赞。

## TC-04 getLikesByPostIds 全量聚合（验收 4 主路径）

- **Given** P1、P2 各有点赞（不同用户 / 时间）**When**
  `getLikesByPostIds([P1, P2])` **Then** 返回两帖全部点赞记录，
  集合完备（按 (post_id, user_id) 比对）；每条字段
  post_id / user_id / created_at 齐备，created_at 为可解析 ISO 8601。
- 顺序不保证：断言用集合比对，不断言返回顺序。

## TC-05 入参去重（验收 4 边界）

- **Given** alice 已赞 P1 **When** `getLikesByPostIds([P1, P1, P1])`
  **Then** (P1, alice) 恰出现一次（重复入参不放大结果）。

## TC-06 空入参（验收 4 边界）

- **When** `getLikesByPostIds([])` **Then** 返回 `[]`（不报错、不产出 SQL）。

## TC-07 无点赞的帖 id / 未知 id

- 入参含从未被点赞的帖 id（或混入有效 id）：仅返回存在记录，
  缺记录帖自然不出现，不报错、不产生占位行。

## TC-08 点赞—取消—再点赞生命周期（跨重启持久）

- like → unlike → like：全程 COUNT 在 1 → 0 → 1 间迁移，
  再点赞后记录仍恰一条；重复 like 不复活第二条。
- close 后重新 DataStore(path) 等价应用重启：点赞记录仍在，
  幂等语义不变（口径对齐 tests/test_follow.py TC-10）。

## 不覆盖（非范围）

- 可见性过滤与可见计数（FP-004）；HTTP 动作与 toggle（FP-007）；
  Node 侧同形 Mock（FP-005）；外键违约（引用不存在帖 / 用户）的错误
  语义——任务卡未定义，归消费方任务。
