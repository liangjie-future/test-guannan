# 设计笔记 FP-015：时间线聚合与排序

## 目标

交付 `getTimeline(user_id)` 服务：按「全部被关注用户集合」聚合帖子，仅返回被关注对象的帖子（不含未关注用户与自己的帖子，上游 D7），按 `created_at` 倒序（新帖在前，同时刻次序不限定）；未关注任何人返回空集合。

## 技术选型

- **语言**：Python 3（任务卡语言无关；强依赖 FP-001 已用 Python 3 + SQLite 落地，本任务是 FP-001 §3.2 契约的直接消费方，同语言零胶水成本，与 FP-011 / FP-013 服务层同一形态）。
- **形态**：纯服务层（无 HTTP、无 UI）——§5 明确页面渲染归 FP-014、关注建立归 FP-011、帖子产生归 FP-013、分页与推荐排序延后不做。

## 关键决策

1. **TimelineService 只依赖 §3.2 契约形状（鸭子类型）**：构造 `TimelineService(store)`，仅使用 `getFolloweeIds / getPostsByAuthorIds / getUserById` 三个方法。不 import FP-001 具体类，满足 §6「未实现时可换内存模拟」；测试同时覆盖真实 `DataStore` 与内存替身两条路径。
2. **聚合管线 = 契约描述的顺序**：`getFolloweeIds(user_id)` → 集合化并剔除自身（防御性，自关注边在 FP-001 层已不可能，Mock 路径仍受保护）→ `getPostsByAuthorIds(followee_ids)` → 逐帖过滤 `author_id != user_id 且 author_id ∈ followee_ids`（范围双条件显式化，上游存储「顺序不保证」故过滤在本层重申）→ `created_at` 降序排序。空关注集合时跳过取帖直接返回 `[]`。
3. **排序按时间瞬间而非字典序**：`created_at` 为 ISO 8601 文本，同为 UTC 且同格式时字典序等价时间序，但混入不同时区偏移（如 `+02:00`）或无时区文本时字典序会错。排序键统一 `datetime.fromisoformat` 解析，naive 视为 UTC（`replace(tzinfo=utc)`），保证跨偏移 / 跨格式按真实瞬间降序。同时刻并列用稳定排序，次序不限定（契约允许）。
4. **作者信息补全口径：本任务一并补齐（§4 二选一，取「本任务补齐」并保持一致）**：每条返回条目 = 帖子四字段副本 + `author_username`（经 `getUserById(author_id)` 查得；作者不存在时为 `None`，外键约束下正常不发生，仅 Mock 路径可现）。§3.2 将 `getUserById` 列为本任务消费的依赖能力（「供展示作者名」），在此兑现；条目仍携带 `author_id`，页面（FP-014）无需再逐帖回查。
5. **返回条目为帖子字典的浅副本**：不修改存储层返回的对象（Mock 可能持有内部引用），时间线侧的补全字段（`author_username`）不污染 posts 表切片形状。
6. **无错误分支**：契约未定义任何失败分支——查询主体不存在 → 无关注边 → 空集合，自然坍缩，不额外造错误类型。
7. **非范围**（§5）：不做页面渲染（FP-014）、不做关注建立（FP-011）、不做帖子产生与校验（FP-013）、不做分页 / 加载更多（上游 P5）、不做推荐 / 热门排序（上游 P2）。

## 目录结构

```
services/
  __init__.py      # 追加导出 TimelineService
  timeline.py      # getTimeline 聚合 + 过滤 + 倒序实现
tests/
  test_timeline.py # 对应 docs/test-cases/FP-015-timeline-aggregate-sort.md
docs/
  designs/FP-015-timeline-aggregate-sort.md
  test-cases/FP-015-timeline-aggregate-sort.md
```

## Mock 与种子策略（§6）

FP-001 已合入，主验证路径用真实 `DataStore`（临时 SQLite 文件）。种子对齐任务卡 §6：用户 A(id=1 查询主体)/B(id=2)/C(id=3)/D(id=4 未关注)；关注边 A→B、A→C；帖子 B×2（t1、t4）+ C×2（t2、t3，与 B 交错）+ A×1 + D×1，t1<t2<t3<t4 使倒序结果唯一可断言（期望 t4→t3→t2→t1）。帖子以显式时间戳直插 SQLite（`created_at` 为 TEXT 列，契约只约束可解析性），保证时间交错确定。空态场景用无关注边变体种子（A 自己有帖）验证。另在测试内定义内存契约替身（users 字典 + posts 列表 + follows 集合）重放核心断言，覆盖「依赖未实现按 §6 模拟」路径；替身留在测试侧，不进生产代码。
