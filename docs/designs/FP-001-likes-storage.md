# 设计笔记 FP-001：点赞数据表与存取原语（mutual-friend-interaction-visibility）

> 来源任务卡：input/tasks/mutual-friend-interaction-visibility/FP-001-likes-storage.task.md
> 优先级 P0｜里程碑 M1（地基）｜波次 1。注意与旧项目
> `FP-001-core-data-storage` / `FP-016-mutual-friend-engagement-visibility` 同名前缀，
> 本设计属于新项目拆解，文档以 `likes-storage` 后缀区分。

## 目标

在 Python 存储层提供 likes 表与点赞 / 取消 / 按帖聚合三类存取原语，
保证一人一帖恰一条（幂等），为后续互动可见性过滤（FP-004 等消费方）
提供全量点赞数据源。

## 现状盘点（关键决策的依据）

- `storage/store.py._SCHEMA` 已含 `likes` 表（旧项目 FP-016 引入）：
  列 / 复合主键 / 双外键与任务卡 §3.1 完全一致，**但缺
  `idx_likes_user_id` 索引**——本任务补齐（`CREATE INDEX IF NOT EXISTS`
  在每次 `DataStore(path)` 构造时执行，存量库下次打开即生效）。
- 既有 `addLike` / `getLikesByPostId`（单帖版）被 `services/engagement.py`
  与 `tests/test_engagement.py` 消费，**保留不动**；本任务按任务卡新增
  `likePost` / `unlikePost` / `getLikesByPostIds` 三个原语。

## 关键决策

1. **表结构零改动、只补索引**：likes 表 DDL 与任务卡 §3.1 逐字一致
   （(post_id, user_id) 复合主键即「一人一帖至多一条」的库级保证；
   两列分别外键 posts(id) / users(id)），索引风格对齐既有
   idx_posts_author_id / idx_follows_follower_id。
2. **likePost 幂等写**：`INSERT OR IGNORE ... VALUES (?, ?, ?)` 同时写入
   `created_at`（`_now()`，UTC ISO 8601，口径同 users/posts）——重复执行
   恰一条、不抛错。语义与既有 `addLike` 完全同构，直接委托复用
   （消除重复 SQL）。
3. **unlikePost 幂等删**：`DELETE FROM likes WHERE post_id=? AND user_id=?`
   ——行不存在时 DELETE 本身不报错，天然幂等；不做存在性预查（免竞态、
   免多余往返）。
4. **getLikesByPostIds 批量读**：入参先 `dict.fromkeys` 去重（保序、对齐
   `getPostsByAuthorIds` 口径），再分块 `IN` 查询（SQLite 绑定变量上限，
   复用 500 一段的常量）；空入参短路返回 `[]`（不拼空 IN——SQL 语法
   错误路径零可能）。**返回全量记录** `[{post_id, user_id, created_at}]`，
   集合完备、顺序不保证——过滤 / 排序语义归 FP-004 消费方。
5. **不做**：可见性过滤与可见计数（FP-004）、HTTP 路由与 toggle
   （FP-007）、Node 侧同形 Mock（FP-005）。

## 存储层接口（本任务产出的契约源头）

```python
store = DataStore(tmp_path / "social.db")   # 构造即建表（含两个 likes 索引）
store.likePost(post_id, user_id)            # 点赞：幂等，恰一条，不抛错
store.unlikePost(post_id, user_id)          # 取消：删行，幂等
store.getLikesByPostIds(post_ids)           # 按帖 id 集合取全量点赞记录
```

## 验证口径

`tests/test_likes.py`（风格对齐 tests/test_follow.py）：真实 SQLite
临时文件 + §6 种子（alice=1 / bob=2 / carol=3，P1=bob、P2=carol，点赞
经 likePost 写入）；验收 1 经 `PRAGMA table_info / index_list /
foreign_key_list` 断言结构与索引，验收 2–4 「接口断言 + 直查 SQL COUNT」
双口径。详见 docs/test-cases/FP-001-likes-storage.md。

## 目录结构

```
storage/store.py                          # +idx_likes_user_id +三原语
tests/test_likes.py                       # TC-01 ~ TC-08
docs/designs/FP-001-likes-storage.md      # 本文件
docs/test-cases/FP-001-likes-storage.md   # 测试场景清单
```
