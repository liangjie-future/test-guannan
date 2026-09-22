# 测试场景 FP-003：好友与共同好友关系推导原语

对应验收标准（任务卡 §7 验收 1–4）与边界 / 错误路径。
测试文件：`tests/test_friends.py`，运行 `pytest tests/test_friends.py`。

种子约定（§6）：alice(1) / bob(2) / carol(3)；关注边 alice→bob、bob→alice
（互关）、alice→carol（单向，carol 未回关）、bob→carol、carol→bob（互关）——
即 好友(alice)={bob}、好友(bob)={alice, carol}。
变体种子 S2 在字面种子上补 `carol→alice`（carol 与双方均互关）；
解除互关以独立连接直接 `DELETE FROM follows` 模拟（系统无取关原语）。

> 规格矛盾裁决（详见 docs/designs/FP-003-friend-relations.md）：按 §4 公式
> `mutualFriendIds(v,a) = friendIds(v) ∩ friendIds(a)`，字面种子上
> `mutualFriendIds(alice, bob)` = {bob} ∩ {alice, carol} = **∅**，与验收 2 的
> `{carol}` 互斥（后者基于「carol↔alice 也互关」的图才成立）。以公式为准，
> 验收 2 的场景形状以变体种子 S2 验证。

## TC-01 friendIds 双向互关判定（验收 1）

- **步骤**：种子上 `friendIds(alice)`、`friendIds(bob)`、`friendIds(carol)`。
- **期望**：`friendIds(alice) == {bob}`（carol 未回关不算好友）；
  `friendIds(bob) == {alice, carol}`；`friendIds(carol) == {bob}`；
  返回类型为 `set`（次序无意义）。

## TC-02 mutualFriendIds 交集（验收 2，按裁决双轨）

- **步骤（字面种子）**：`mutualFriendIds(alice, bob)`（两个参数序各一次）。
- **期望**：`== friendIds(alice) & friendIds(bob) == ∅`（记录矛盾裁决）；
  参数次序不影响结果（交集对称）。
- **步骤（变体 S2：补 carol→alice，carol 与双方均互关）**：
  `mutualFriendIds(alice, bob)`。
- **期望**：`== {carol}`——「carol 与双方均互关 ⇒ 在共同好友中」，
  即验收 2 的场景形状。

## TC-03 边删除实时生效（验收 3，无快照）

- **步骤（S2 变体）**：独立连接直接 SQL 删除 carol→bob 后再
  `mutualFriendIds(alice, bob)`；另一变体删除 bob→carol 方向。
- **期望**：carol 不再出现在结果中（实时按当前边判定，无快照）；
  对称地 `friendIds(bob)` 不再含 carol、`friendIds(carol)` 不再含 bob。
- **步骤（字面种子）**：删除任一 bob↔carol 方向边后再查询。
- **期望**：carol 不在 `mutualFriendIds(alice, bob)` 结果中（验收 3 字面
  成立；此图上结果本为 ∅）；`friendIds(bob)` 实时失去 carol。
- **步骤（单向边删除不扰动）**：删除本就单向的 alice→carol。
- **期望**：`friendIds(alice)` 仍为 {bob}，`mutualFriendIds` 不变。

## TC-04 无共同好友（验收 4）

- **步骤**：新建用户 dave（无任何边）后 `mutualFriendIds(alice, dave)`。
- **期望**：返回空集合；`friendIds(dave)` 亦为空集合。

## TC-05 新增边实时生效（边界，TC-03 的对偶）

- **步骤**：字面种子上 `addFollow(carol, alice)` 补全互关（即得到 S2）后再查询。
- **期望**：`friendIds(alice)` 变为 {bob, carol}；
  `mutualFriendIds(alice, bob)` 仍不含 bob/alice 且新出现 {carol}、
  `mutualFriendIds(alice, carol)` 新出现 {bob}——无缓存 / 快照。

## TC-06 无快照：查询不产生副作用

- **步骤**：多次重复 `friendIds` / `mutualFriendIds`，前后数 follows 行数。
- **期望**：重复查询结果稳定一致；follows 行数不变（纯读）。

## TC-07 不存在的用户与同参（错误路径 / 自然坍缩）

- **期望**：`friendIds(999)` → 空集合（无错误分支，口径同 FP-015 查询
  坍缩）；`mutualFriendIds(alice, 999)` / `mutualFriendIds(999, 999)` →
  空集合；`mutualFriendIds(alice, alice) == friendIds(alice)`（同参交集
  退化为自身好友集）。

## TC-08 自关注禁令传导（边界，口径基础）

- **期望**：种子上 `addFollow(x, x)` 抛 `SelfFollowError`（既有行为），
  且任何用户不在自己的 `friendIds` 结果中——保证「无人是自己的好友」，
  支撑后续帖主自互动可见性口径。

## TC-09 跨重启持久（FP-001 集成）

- **步骤**：种子上关闭重开（等价重启）后再查询。
- **期望**：`friendIds` / `mutualFriendIds` 结果与重启前一致（推导基于
  持久化的 follows 边，无内存态）。

## TC-10 返回值为独立副本（边界）

- **步骤**：拿到 `friendIds(alice)` 返回的 set 后原地修改，再查一次。
- **期望**：修改返回集合不影响后续查询结果（每次调用新算新集合）。
