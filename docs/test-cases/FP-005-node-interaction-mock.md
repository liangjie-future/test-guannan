# 测试场景 FP-005：互动与可见性服务 Node 侧 Mock

对应任务卡 §7 三条验收标准（默认种子过滤语义 / 替换注入零改动 / 空态）与
边界路径。测试文件：`tests/interaction-store.test.js`，
运行 `node --test tests/interaction-store.test.js`。

种子约定（§6 标准场景）：用户 alice=1 / bob=2 / carol=3 / dave=4；互关边
alice↔bob、alice↔carol、bob↔carol、bob↔dave（好友(1)={2,3}、好友(2)={1,3,4}、
好友(3)={1,2}、好友(4)={2}；共同好友(1,2)={3}、共同好友(1,4)={2}）；帖
P1 = `{id: 1, author_id: 2}`（bob，查询时传入）；点赞 carol/dave/bob→P1；
评论 c1 carol(t1) / c2 dave(t2) / c3 bob(t3) / c4 alice(t4)，t1<t2<t3<t4。

## TC-01 默认种子：可见性过滤核心（验收 1 主场景）

- **步骤**：`getVisibleInteractions(alice, [P1])`。
- **期望**：恰一条结果，结构与契约逐项同形——`{post_id: 1,
  likes: [{user_id, created_at}], comments: [{id, user_id, content,
  created_at}], visible_like_count, visible_comment_count}`；carol 的
  点赞与评论在；dave（仅 bob 的好友，非共同好友）的点赞与评论不在；
  bob（帖主）自互动自然排除；alice 自身评论 c4 在（D5 查看者恒可见）；
  计数仅含可见条目（1 赞 / 2 评）；可见评论按 created_at 升序
  （c1 在 c4 前）。

## TC-02 帖主视角与查看者无好友（可见集公式变体）

- **步骤**：`getVisibleInteractions(bob, [P1])`（S(2,2)=好友(2)∪{2}）
  与 `getVisibleInteractions(999, [P1])`（未知查看者）。
- **期望**：bob 视角见全部 3 赞 / 4 评（四人全在可见集）；未知查看者
  可见集仅 {999} → 空数组与 0 计数，不抛错（空可见集 → 空态）。

## TC-03 好友与共同好友原语

- **期望**：`friendIds`：alice→[2,3]、bob→[1,3,4]、carol→[1,2]、
  dave→[2]、未知→[]；`mutualFriendIds`：(1,2)→[3]、(1,3)→[2]、
  (1,4)→[]、(2,2)→[1,3,4]；一律升序副本。

## TC-04 点赞写入与取消：幂等（边界）

- **步骤**：`likePost(1, alice)` 两次 → `getLikesByPostIds([1])`；
  `unlikePost(1, carol)` 两次。
- **期望**：重复点赞后仍恰一条（alice）；重复取消不抛错、不误删他人
  记录；取消后可见计数即时反映（写入路径影响读路径，无快照）。

## TC-05 评论写入：id 自增、形状、内容不校验（边界）

- **期望**：`createComment` 返回 `{id, post_id, user_id, content,
  created_at}`，id 从种子最大 id（4）续增至 5/6…；内容原样存储——空白
  文本、281 字均不拒绝（校验归 FP-008）；`created_at` 取注入 `now`
  （可注入时钟确定性验证）。

## TC-06 排序：时间升序与并列稳定（边界）

- **前置**：自定义种子：评论乱序注入（t3,t1,t2）且两条同时刻不同 id；
  点赞两条同时刻不同 user、跨帖同时刻。
- **期望**：`getCommentsByPostIds` 按 created_at 升序、同时刻按 id 升序；
  `getLikesByPostIds` 按 created_at 升序、同时刻按 (post_id, user_id)
  升序；跨帖查询全局同口径；未知 post_id → 空数组。

## TC-07 空种子：空态可模拟（验收 3）

- **步骤**：显式注入 `{users: [], followEdges: [], likes: [], comments: []}`。
- **期望**：`getLikesByPostIds` / `getCommentsByPostIds` / `friendIds` /
  `mutualFriendIds` 返回空集合；`getVisibleInteractions` 返回
  `{likes: [], comments: [], visible_like_count: 0, visible_comment_count: 0}`
  条目；写原语仍可用（评论 id 从 1 起）。

## TC-08 自定义注入种子：替换性（边界）

- **期望**：传入与默认不同的用户 / 边 / 点赞 / 评论 → 默认种子被完全
  替换（friendIds / 查询结果反映自定义数据，不含默认场景任何残留）。

## TC-09 副本防御（边界）

- **期望**：修改 `getLikesByPostIds` / `getCommentsByPostIds` /
  `getVisibleInteractions` / `friendIds` 返回的对象或数组，以及构造后
  修改传入的种子数组，均不影响后续查询结果。

## TC-10 多帖查询与输入顺序（边界）

- **步骤**：`getVisibleInteractions(alice, [P1, P2])`（P2=carol 帖、
  无互动）与 `getVisibleInteractions(alice, [])`。
- **期望**：逐帖按输入顺序一条结果；无互动帖 → 空数组 + 0 计数；
  空帖列表 → 空数组。

## TC-11 替换注入零改动切换（验收 2）

- **步骤**：按 §3.2 契约编写消费方用例（读快照函数 + 写操作序列，
  仅调用八个契约方法），先注入本 Mock、再注入测试内第二实现（数组 +
  线性扫描、内部结构不同、签名 / 返回形状相同），同一操作序列后比对
  全量快照。
- **期望**：两次快照 deep-equal；消费方代码零改动（注入即切换）。

## 运行

```bash
node --test tests/interaction-store.test.js   # 本任务
npm test                                      # Node 全量回归
python3 -m pytest -q                          # Python 侧回归（不受影响）
```
