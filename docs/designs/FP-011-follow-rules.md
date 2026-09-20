# 设计笔记 FP-011：关注关系规则

## 目标

交付关注关系规则服务：建立关注者→被关注者的单向关系（无需对方确认、不自动反向）；禁止关注自己（上游 D5）；重复关注幂等；并提供被关注者集合查询 `getFollowees`（供 FP-015 时间线聚合与 FP-010 页面已关注态消费）。

## 技术选型

- **语言**：Python 3（任务卡语言无关；强依赖 FP-001 已用 Python 3 + SQLite 落地，本任务是 FP-001 §3.2 契约的直接消费方，同语言零胶水成本）。
- **形态**：纯服务层（无 HTTP、无 UI）——§5 明确页面按钮归 FP-010、持久化归 FP-001、时间线聚合归 FP-015。

## 关键决策

1. **FollowService 只依赖 §3.2 契约形状（鸭子类型）**：构造 `FollowService(store)`，只用 `addFollow / followExists / getFolloweeIds / getUserById` 四个方法。不 import FP-001 具体类，天然满足 §6「FP-001 未合入时可换内存模拟」；测试同时用真实 `DataStore` 与内存替身各跑一遍，验证两种路径。
2. **follow() 校验顺序 = 契约分支顺序**（§3.2）：
   1. `follower_id == followee_id` → 抛 `SelfFollowNotAllowedError`（消息「不可关注自己」），先于存在性判断（对不存在的 id 自关注同样报自关注错，与契约首分支一致）；
   2. `getUserById(followee_id) is None` → 抛 `FolloweeNotFoundError`（消息「用户不存在」）；
   3. 否则 `addFollow(follower_id, followee_id)`——FP-001 已保证幂等（`INSERT OR IGNORE` + 复合主键唯一），重复调用不报错、不产生第二条边。
   建边即完成：单向、无需确认、无任何反向副作用（不写 followee→follower 边）。
3. **错误语义独立于存储层**：服务层自定义 `FollowError` 基类 + 两个子类（`SelfFollowNotAllowedError` / `FolloweeNotFoundError`），不复用 storage 的 `SelfFollowError`（那是持久化层异常，层次不同），消息严格取契约原文「不可关注自己」「用户不存在」。
4. **getFollowees(user_id) → [followee_id]**：直接映射 `getFolloweeIds`，返回被关注者 id 列表（唯一约束保证无重复）。「时间线聚合的数据来源」即 FP-015 `getPostsByAuthorIds(author_ids)` 的入参；页面已关注态用 `uid in getFollowees(uid)` 判断。不额外做 `isFollowing` 便捷方法（§4 未要求，保持最小面）。
5. **不校验 follower 存在性**：契约错误分支仅含自关注与被关注者不存在；关注者由上游会话层（FP-003）保证为已认证用户。若传入不存在的 follower，FP-001 外键约束兜底报存储错误，不在本层重新定义语义。
6. **无返回值**：`follow()` 契约未定义返回内容，幂等成功与新建成功对外行为一致（均为成功、恰一条边），调用方需要区分时用 `followExists` 查询。
7. **非范围**（§5）：不做取消关注（上游 D6）、不做关注按钮 / 列表展示（FP-010）、不做时间线聚合（FP-015）、不做 follows 表本身（FP-001）。

## 目录结构

```
services/
  __init__.py    # 导出 FollowService 与错误类型
  follow.py      # follow / getFollowees 规则实现
tests/
  test_follow.py # 对应 docs/test-cases/FP-011-follow-rules.md
docs/
  designs/FP-011-follow-rules.md
  test-cases/FP-011-follow-rules.md
```

## Mock 与种子策略（§6）

FP-001 已合入，主验证路径用真实 `DataStore`（临时 SQLite 文件）+ 种子用户 A(id=1)/B(id=2)/C(id=3)、种子边 A→B（新建库自增 id 恰为 1/2/3，与任务卡种子编号对齐）。另在测试内定义内存契约替身（集合模拟 follows 唯一性 + users 存在性）跑同一套规则断言，覆盖「依赖未实现按 §6 模拟」的路径；替身留在测试侧，不进生产代码（无死代码）。
