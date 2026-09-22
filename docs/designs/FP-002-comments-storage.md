# 设计笔记 FP-002：评论数据表与存取原语

## 目标

在 Python 存储层交付 comments 表契约与两类存取原语：
`createComment(post_id, user_id, content)`（写入并返回完整评论行）与
`getCommentsByPostIds(post_ids)`（按帖集合聚合、`created_at` 正序）。
本任务为可见性过滤（FP-004 / FP-006）提供评论数据源。

## 技术选型

- **语言 / 形态**：Python 3 标准库 `sqlite3`，直接扩展既有
  `storage/store.py` 的 `DataStore`（FP-001 §3.2 契约载体），不新建模块。
- **表结构**：任务卡 §3.1 给出的 SQL 与既有 `posts` 表风格逐字段对齐
  （id 自增主键 / 外键 / `created_at TEXT` / 命名索引）。

## 现状与关键决策

1. **comments 表契约已存在，本任务确认并消费**：合入历史中的 FP-016
   （互动可见性）已将与任务卡 §3.1 完全一致的 `comments` 表与
   `idx_comments_post_id` 索引写入 `_SCHEMA`（`CREATE TABLE IF NOT EXISTS`
   幂等）。本任务不重复迁移，仅验收其形状（自增主键、外键、TEXT 时间列、
   命名索引，见 TC-01）。
2. **FP-002 规范名落地 + FP-016 名称收敛为别名，避免双实现**：
   - `createComment` 为唯一写实现（存储层不做内容校验——1–280 字规则归
     上层，对齐 `createPost` 先例）；既有 `addComment`（FP-016 规范名）
     改为一行委托，语义不变，FP-016 服务与测试零改动。
   - `getCommentsByPostIds(post_ids)` 为集合读实现；既有单帖
     `getCommentsByPostId(post_id)` 委托 `getCommentsByPostIds([post_id])`。
     其「顺序不保证」契约不破坏——确定性排序是该契约的合法实例，且
     FP-016 服务层本就自行按时间瞬间重排（`_visible_sorted`）。
3. **排序口径：`(created_at, id)` 字典序元组**：`created_at` 为同格式
   UTC ISO 8601 文本（`_now()` 统一产出），字典序即时间序；同时刻按
   `id` 升序保证确定性（任务卡 §4 显式要求）。排序在收集全部结果后以
   单次 Python 排序完成——IN 分块查询（复用 FP-001 的分块上限常量，
   防 SQLite 绑定变量上限）无法保证跨块有序，最终统一排序是唯一
   排序权威。跨时区偏移文本的「真实瞬间」归一不是本层职责（先例：
   FP-015 / FP-016 服务层用 `datetime.fromisoformat` 自行归一）。
4. **入参归一**：`list(dict.fromkeys(post_ids))` 去重保序（口径同
   `getPostsByAuthorIds`）；空入参直接短路返回 `[]`（不发 SQL）。
5. **非范围**（§5）：内容校验归提交动作层；可见性过滤归判定服务；
   编辑 / 删除 / 回复 / 嵌套原语不提供（上游 D7）。

## 目录结构

```
storage/
  store.py          # createComment / getCommentsByPostIds 原语；
                    # addComment / getCommentsByPostId 收敛为委托别名
tests/
  test_comments.py  # 对应 docs/test-cases/FP-002-comments-storage.md
docs/
  designs/FP-002-comments-storage.md
  test-cases/FP-002-comments-storage.md
```

## Mock 与种子策略（§6）

真实 SQLite 任务，无 Mock 依赖。种子对齐任务卡 §6：alice(1) / bob(2) /
carol(3) 用户 + 帖 P1（bob）；时序场景（多条不同 `created_at`、同时刻
并列、同用户重复评论）用直接 SQL 插入指定 `created_at` 构造
（`created_at` 为 TEXT 列，契约只约束可解析性），保证断言确定。
