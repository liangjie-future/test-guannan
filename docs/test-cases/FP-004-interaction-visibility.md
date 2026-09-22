# 测试场景 FP-004：互动可见性判定服务

对应验收标准（任务卡 §7 验收 1–6）与边界 / 错误路径。
测试文件：`tests/test_interactions.py`，运行 `pytest tests/test_interactions.py`。
全部用例走 §6 内存 Stub 种子（不依赖 FP-001/002/003 运行时产出）。

种子约定（§6）：alice=1 / bob=2 / carol=3 / dave=4（另 erin=5 无任何边，
供验收 6）；互关边 alice↔bob、alice↔carol、bob↔carol、bob↔dave；
帖 P1（author=bob，id=1）；点赞 carol(tL1) / dave(tL2) / bob(tL3)（帖主自赞）；
评论 c1 carol「+1」(t1) / c2 dave「同看」(t2) / c3 bob 自评 (t3) /
c4 alice「路过」(t4)，t1<t2<t3<t4。变体种子 S5（验收 5）：仅 alice→bob
单向、carol↔alice 与 carol↔bob 互关。

## TC-01 visibleSet 公式直译（验收 1 前置）

- **步骤**：`visibleSet(1, 2)`（alice 对 bob）；类型断言。
- **期望**：`== {1, 3}`（共同好友 {carol} ∪ {alice}）；类型为 `set`；
  帖主 bob（2）**不在**集内（帖主不是自己的好友）；查看者恒在集内。
- **步骤（同参）**：`visibleSet(2, 2)`。
- **期望**：`== friendIds(bob) ∪ {bob} == {1, 2, 3, 4}`（同参交集退化为
  自身好友集，查看者＝帖主时自身经 ∪{V} 入集——公式自然结果）。
- **步骤（无互关 / 未知用户）**：`visibleSet(5, 2)`、`visibleSet(999, 2)`。
- **期望**：分别为 `{5}` / `{999}`（交集为空坍缩到仅查看者，无错误分支）。

## TC-02 标准场景过滤（验收 1，主场景）

- **步骤**：alice `getVisibleInteractions(1, [P1])`。
- **期望**：`likes` 恰为 `[carol 点赞]`（不含 dave、不含 bob 自赞）；
  `comments` id 序 `[c1, c4]`（carol 与 alice 自己，created_at 正序）；
  `visible_like_count == 1`、`visible_comment_count == 2`；返回对象键
  恰为五键 `{post_id, likes, comments, visible_like_count,
  visible_comment_count}`（D8：无任何隐藏量差字段）。

## TC-03 帖主自互动自然排除（验收 2）

- **步骤**：标准场景（bob 自赞 + 自评 c3 在种子中），alice 查 P1。
- **期望**：likes 无 user_id=2；comments 无 id=3——非特判剔除，而是
  公式自然结果（前置断言 `2 ∉ visibleSet(1, 2)` 与 `2 ∉ friendIds(2)`）。

## TC-04 查看者自身恒可见（验收 3，D5 特例）

- **步骤**：标准场景（alice 自己的 c4 在种子中），alice 查 P1。
- **期望**：c4（id=4）总在 comments 中且计入 visible_comment_count——
  即使 `friendIds(alice) ∩ friendIds(bob)` 不含 alice（经 ∪{V} 入集）。

## TC-05 删边实时生效（验收 4，无快照）

- **步骤**：从 Stub 直接删 carol→bob 方向边后 alice 再查；恢复后删
  bob→carol 方向再查（两个方向各一次）。
- **期望**：carol 的点赞与评论退出返回（likes 变空、comments 仅 [c4]），
  计数同步降为 0/1——可见性按 follows 当前边实时判定，无快照。

## TC-06 非好友帖主统一规则（验收 5，D2）

- **步骤**：变体种子 S5（仅 alice→bob 单向，carol 与 alice、bob 均互关，
  carol 评论 P1），前置断言 `2 ∉ friendIds(1)`，alice 查 P1。
- **期望**：carol 的评论在返回中（非好友帖主走同一条交集规则，
  `mutualFriendIds(1, 2) == {3}`）。

## TC-07 无边用户空态（验收 6）

- **步骤**：erin（无任何边、无互动）查 P1；前置 `visibleSet(5, 2) == {5}`。
- **期望**：`likes == []`、`comments == []`、计数 0/0；返回对象不含任何
  「存在被隐藏内容」的字段或计数差（五键形状，值为空 / 零）。

## TC-08 多帖集合与空入参（边界）

- **步骤**：alice 查 `[P1, P2]`（P2＝carol 的无互动帖，插入顺序 P2 在前）
  与 `[]`。
- **期望**：逐帖按**输入顺序**返回；P2 空列表与 0 计数；空入参 → `[]`；
  同作者多帖不重复推导互关（行为等价即可）。

## TC-09 排序：真实瞬间升序与并列按 id（边界）

- **步骤**：likes 以时间乱序的插入序入 Stub（契约「顺序不保证」），
  查看结果顺序；comments 种子含同时刻并列（不同 id）与 +02:00 偏移文本
  （字典序晚于 UTC 文本但真实瞬间更早）。
- **期望**：likes 按 created_at 真实瞬间升序；comments 同时刻按 id 升序；
  偏移文本按瞬间归一排序（字典序会排错位，口径同 FP-015 / FP-016）。

## TC-10 返回值为副本（边界）

- **步骤**：拿到返回对象后原地改 likes / comments 条目与外层计数，再查一次。
- **期望**：第二次查询结果不受影响（投影即副本，不污染 Stub 内部状态）。

## TC-11 Stub 契约形状自证（§6 基建）

- **步骤**：对 Stub 直接调 `likePost`（重复）/ `unlikePost`（未点）/
  `createComment` / `getLikesByPostIds` / `getCommentsByPostIds`。
- **期望**：点赞幂等（恰一条）、取消幂等（不报错）、评论返回完整行
  `{id, post_id, user_id, content, created_at}` 且 id 自增、按帖集合聚合
  完备、空入参空返回——保证测试基建忠实于 §3.2 契约形状。
