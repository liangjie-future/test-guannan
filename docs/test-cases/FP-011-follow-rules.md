# 测试场景 FP-011：关注关系规则

对应验收标准（任务卡 §7）与独立验证方式（§8）。测试文件：`tests/test_follow.py`，运行 `pytest`。

主验证路径：真实 `DataStore`（FP-001，临时 SQLite 文件）+ §6 种子（用户 A=1、B=2、C=3，种子边 A→B）。
辅助路径：内存契约替身（§6 内存集合模拟）跑同一套核心规则，验证服务与存储解耦。

## TC-01 建立单向关注（验收 1）

- **前置**：种子 A、B（A≠B），无 A→B 边的场景（新建用户 a、b）。
- **步骤**：`follow(a, b)`。
- **期望**：`followExists(a, b) → True`；follows 表中仅此一条边（原始计数=1）；**无反向边** `followExists(b, a) → False`、`getFollowees(b) == []`（B 不因此关注 A，无需 B 确认——模型中不存在任何确认态）。

## TC-02 重复关注幂等（验收 2）

- **前置**：种子边 A→B 已存在。
- **步骤**：再次 `follow(1, 2)`。
- **期望**：不抛错（幂等成功）；关系仍恰一条边（follows 原始计数=1，`getFollowees(1) == [2]`）；且不影响其他边（再 follow(1,3) 后 A 的被关注者集合 = {2,3}）。

## TC-03 禁止自关注（验收 3）

- **前置**：任意已存在用户 A。
- **步骤**：`follow(1, 1)`。
- **期望**：抛 `SelfFollowNotAllowedError`，消息含「不可关注自己」；不产生边（`followExists(1,1) → False`，follows 计数不变）。

## TC-04 自关注判断优先于存在性

- **步骤**：`follow(999, 999)`（id 不存在的用户自关注）。
- **期望**：抛 `SelfFollowNotAllowedError`（契约首分支），而非「用户不存在」。

## TC-05 关注不存在的用户

- **前置**：A 存在，id=999 用户不存在。
- **步骤**：`follow(1, 999)`。
- **期望**：抛 `FolloweeNotFoundError`，消息含「用户不存在」；不产生边。

## TC-06 getFollowees 查询

- 多被关注者：A→B、A→C → `getFollowees(A)` 恰含 {B, C}（集合断言，无重复）；
- 未关注任何人 → `[]`；
- 集合内容与 `followExists` 逐边一致（页面已关注态的数据来源）。

## TC-07 单向性不产生任何反向副作用

- **步骤**：`follow(a, b)` 后检查 b 的视角。
- **期望**：`getFollowees(b) == []`、`followExists(b, a) → False`；B 仍可独立关注他人（b→c 仅产生 b 的边）。

## TC-08 多关注者互不影响

- **步骤**：A→C、B→C。
- **期望**：两条边各自存在；`getFollowees(A)`、`getFollowees(B)` 互不串扰；重复 A→C 幂等不影响 B→C。

## TC-09 错误类型语义

- `SelfFollowNotAllowedError` / `FolloweeNotFoundError` 均为 `FollowError` 子类（调用方可统一捕获）；两者互不为子类。

## TC-10 跨重启持久（与 FP-001 集成）

- **步骤**：`follow(a, b)` 后关闭并重开存储（等价应用重启）。
- **期望**：`followExists(a, b) → True`、`getFollowees(a)` 不变；重启后再次 `follow(a, b)` 仍幂等。

## TC-11 内存契约替身路径（§6 Mock）

- 用内存集合替身（follows 集合含唯一约束、users 存在性）替代 FP-001 存储，重跑核心规则：建边单向、幂等、自关注拒绝、用户不存在拒绝、getFollowees 正确。
- **期望**：行为与真实存储完全一致（服务仅依赖 §3.2 契约形状）。

## 运行

```bash
pytest -q
```
