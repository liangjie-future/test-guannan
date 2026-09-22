# 设计笔记 FP-003：好友与共同好友关系推导原语

> 来源：FP-003（EN-003 好友与共同好友关系推导 ｜ 数据结构与存储）｜P0 ｜ M1 地基 ｜ 波次 1
> 任务卡：input/tasks/mutual-friend-interaction-visibility/FP-003-friend-relations.task.md

## 目标

在既有 `follows` 边上扩展两个存储层推导原语，为后续「好友帖子互动仅共同好友
可见」（FP-004 互动可见性判定服务）提供判定基础，不新增任何数据结构。

## 术语与口径

- **好友 X** ＝ 与 X 双向互关的用户集合（A→B 且 B→A 同时成立）；单向关注
  不算好友。
- **共同好友(v, a)** ＝ 好友(v) ∩ 好友(a)。
- 关系实时按 `follows` 当前边判定、无快照（任一方向边删除后立即生效）。
- 既有 `SelfFollowError` 禁止自关注 ⇒ 无人是自己的好友——这是后续「帖主
  自互动不可见」口径统一处理的基础。

## 关键决策

1. **纯存储层推导，无新表无新列**：两个方法直接对既有 `follows` 表做
   自连接查询，每次调用实时计算，不物化任何中间结构（无快照失效问题）。
2. **`friendIds` 用 SQL 自连接**（而非 Python 端组合 `getFolloweeIds` +
   逐个 `followExists`）：

   ```sql
   SELECT f1.followee_id FROM follows f1
   JOIN follows f2
     ON f2.follower_id = f1.followee_id AND f2.followee_id = f1.follower_id
   WHERE f1.follower_id = ?
   ```

   `idx_follows_follower_id` / `idx_follows_followee_id` 两个既有索引分别
   服务两侧行定位；单条 SQL 语义即「x→y 且 y→x」，集合完备性与「单向边
   不算」由连接条件直接保证。返回 `set`（次序无意义，任务卡 §4 契约）。
3. **`mutualFriendIds` 复用 `friendIds` 取交集**：
   `friendIds(v) & friendIds(a)`——两个单点查询 + 内存交集，语义直译
   任务卡定义，无需专用 SQL。
4. **读路径无错误分支（自然坍缩口径，同 FP-015 / FP-016 查询面）**：
   不存在的用户 / 无任何关注的用户 → 空集合，不造错误类型；两方法均为
   纯查询，不写库、不 `commit`。
5. **返回值为新的 `set` 副本**：调用方修改返回集合不影响后续查询结果。

## 接口契约（§3.2 / §4）

```python
from storage import DataStore

store = DataStore("data/social.db")
store.friendIds(user_id)      # → set：与 user_id 双向互关的用户 id
store.mutualFriendIds(v, a)   # → set：friendIds(v) ∩ friendIds(a)
```

## 与既有 FP-016 术语的关系

FP-016（更早合入的独立特性）在互动可见性中把「好友」映射为单向
`getFolloweeIds` 口径；本特性组（mutual-friend-interaction-visibility）
按其任务卡改用**双向互关**口径并落到存储原语。两者并存、互不改动：
FP-016 的 `EngagementService` 不在本任务范围内重构（可见性判定归
FP-004 消费本原语实现）。

## 任务卡 §7 验收 2 的矛盾与裁决

任务卡存在一处内部矛盾，裁决如下（公式优先）：

- §1 / §2 / §4 三处一致定义：`mutualFriendIds(v, a) = friendIds(v) ∩ friendIds(a)`；
  §6 种子与验收 1 也一致：好友(alice)={bob}（carol 未回关）、
  好友(bob)={alice, carol}。
- 按此二者，`mutualFriendIds(alice, bob)` = `{bob} ∩ {alice, carol}` = **∅**，
  而验收 2 却期望 `{carol}`，其括注「carol 与双方均互关」与验收 1 的
  「carol 未回关不算好友」直接互斥——carol 仅与 bob 互关，与 alice 是单向边。
- `{carol}` 只有在 carol↔alice 也互关时才成立（此时「与双方均互关」为真、
  验收 3 删边后 carol 掉出也变为非平凡场景），但那会使验收 1 失效。

**裁决**：以规范性的 §4 实现范围公式为准（它同时是 FP-004 消费的契约
可见集(V,A)=好友(V)∩好友(A)∪{V} 的基础），验收 1/3/4 照字面通过；验收 2
按「场景形状」通过——测试同时覆盖：① 字面种子上公式结果为空集（记录
矛盾），② 补全 carol↔alice 互关后 `mutualFriendIds(alice, bob)` == {carol}
（此时「carol 与双方均互关」为真，且验收 3 的删边场景在此图上非平凡）。

## 非范围

- 不做可见性判定与 ∪{V} 特例（FP-004：可见集(V,A)=好友(V)∩好友(A)∪{V}）；
- 不做取消关注 / 删除边的公开原语（上游范围外；测试中解除互关经直接
  SQL 删除 `follows` 行模拟）；
- 不新增表 / 列 / 索引，不改 `follows` 既有行为。

## 目录结构

```
storage/store.py              # DataStore 增补 friendIds / mutualFriendIds
tests/test_friends.py         # 对应 docs/test-cases/FP-003-friend-relations.md
docs/designs/FP-003-friend-relations.md
docs/test-cases/FP-003-friend-relations.md
```

## 种子与验证（§6 / §7 / §8）

真实 SQLite（`DataStore` 临时文件），种子：alice(1) / bob(2) / carol(3)；
边 alice→bob、bob→alice（互关）、alice→carol（单向）、bob→carol、
carol→bob（互关）——即 好友(alice)={bob}、好友(bob)={alice, carol}、
共同好友(alice, bob)={carol}。解除互关场景以独立连接直接 `DELETE FROM
follows` 模拟（系统无取关原语）。验证命令：`pytest tests/test_friends.py`。
