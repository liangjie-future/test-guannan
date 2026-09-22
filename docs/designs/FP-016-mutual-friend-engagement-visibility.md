# 设计笔记 FP-016：好友帖子的点赞评论共同好友可见性

## 目标

新增「互动」数据（点赞 / 评论）与其可见性规则：每个用户查看自己好友的帖子时，
只能看到自己与帖子作者的共同好友留下的点赞和评论；其他人的点赞和评论对该用户不可见。

## 术语与口径（单向关注图上的映射）

本系统无双向好友关系，只有 FP-001 的单向关注边。按既有产品口径映射：

- **好友 X** = X 关注的人（`getFolloweeIds(X)`）。「自己好友的帖子」即时间线上
  被关注对象的帖子（FP-015 同一口径），映射自洽。
- **X 与 Y 的共同好友** = `getFolloweeIds(X) ∩ getFolloweeIds(Y)`（两人都关注的人）。

## 可见性规则（核心）

查看者 V 查看作者 A 的帖子 P 时，可见互动行为者集合：

```
W(V, A) = {V, A} ∪ (F(V) ∩ F(A))      # F(X) = X 的被关注者集合
```

- **共同好友**：V 与 A 都关注的人，其点赞 / 评论对 V 可见——功能主诉求。
- **V 本人**始终可见自己的互动：否则「自己评了一条却看不见」违背基本可用性。
- **A 本人**（帖主）在自己帖下的互动对查看者可见：帖主评论等同回复，业界通行
  （微信朋友圈「朋友点赞评论可见」即此语义：自己 + 帖主 + 共同好友）。
- 其余任何人（仅单方关注 / 陌生人 / 仅帖主单方好友）的互动一律不可见。
- 规则对「非好友的帖子」同样适用（统一计算，不特判）：帖子本身的可见范围
  归 FP-015 时间线，本任务只约束互动的可见性。

## 关键决策

1. **分层**：存储层扩两张表 + 五个原语（FP-001 契约扩展）；规则落在纯服务层
   `services/engagement.py`（`EngagementService`），形态对齐 FP-011 / FP-013 /
   FP-015——无 HTTP、无 UI，鸭子类型仅依赖契约形状，可换内存模拟（§6）。
2. **写路径带规则、读路径无错误分支**：`like` / `comment` 返回
   `{status: OK|ERROR, reason}` 三态（对齐 FP-013）；`getVisibleEngagement`
   是查询，沿用 FP-015「自然坍缩」口径——帖子不存在 → 空列表，不造错误类型。
3. **评论内容规则复用发帖口径**：去首尾空白、按码点计、1–280 字
   （`MAX_COMMENT_LENGTH = 280`），校验顺序 作者存在 → 帖子存在 → 内容非空 →
   长度上限；失败不产生记录。点赞幂等（对齐 FP-011 `addFollow` 与 FP-010
   `created` 语义：重复点赞返回 `created: False`，不产生第二条）。
4. **排序责任在服务层**：存储「顺序不保证」（FP-001 口径），可见点赞 / 评论
   由服务按 `created_at` 时间瞬间升序排（解析 ISO 8601，naive 视为 UTC，口径
   同 FP-015 `_instant`）；并列时刻稳定排序保持插入序。时间线倒序是新帖在前，
   评论 / 点赞升序是互动流的通行展示序。
5. **条目为浅副本并补全 `username`**：不污染存储层形状；行为者缺失时
   `username` 为 `None`（防御口径，外键约束下正常不发生，Mock 路径可现），
   口径同 FP-015 `author_username`。
6. **可见性随关注图即时变化**：`W(V, A)` 每次查询实时计算，不物化快照——
   新关注 / 数据变化立刻反映（系统无取关原语，反向场景以变体种子验证）。

## 存储层扩展（FP-001 契约追加）

```sql
likes    (post_id, user_id, created_at)  PRIMARY KEY (post_id, user_id)
comments (id AUTOINCREMENT, post_id, user_id, content, created_at)
```

新原语：`getPostById` / `addLike`（幂等，返回是否新建）/ `getLikesByPostId` /
`addComment`（返回完整评论对象）/ `getCommentsByPostId`。

## 服务层接口

```python
from services import EngagementService
from storage import DataStore

svc = EngagementService(DataStore("data/social.db"))
svc.like(user_id, post_id)          # → {status: OK, created} | {status: ERROR, reason}
svc.comment(user_id, post_id, text) # → {status: OK, comment}  | {status: ERROR, reason}
svc.getVisibleEngagement(viewer_id, post_id)
# → {"post_id", "likes": [{post_id, user_id, username, created_at}, ...],
#     "comments": [{id, post_id, user_id, username, content, created_at}, ...]}
# 仅含 W(viewer, author) 内行为者的互动，升序；帖子不存在 → 两组皆空
```

错误语义：`USER_NOT_FOUND`（行为者 / 查看者不存在）→ `POST_NOT_FOUND` →
`EMPTY_CONTENT` / `TOO_LONG`（仅评论）；`content` 非字符串抛 `TypeError`
（对齐 FP-013）。给自己点赞 / 评论自己的帖子允许（无规则禁止）。

## 非范围

- 不做页面渲染与时间线条目集成（消费者按契约组合，跨语言桥接同 FP-013 模式）；
- 不做取消点赞 / 删除评论、点赞评论计数聚合、@提及与回复树（上游未定义）；
- 不做帖子本身的可见范围控制（归 FP-015 / 后续权限任务）。

## 目录结构

```
storage/store.py        # likes / comments 表 + 五原语
services/engagement.py  # EngagementService：写规则 + 可见性过滤
services/__init__.py    # 追加导出
tests/test_engagement.py  # 对应 docs/test-cases/FP-016-mutual-friend-engagement-visibility.md
docs/designs/FP-016-mutual-friend-engagement-visibility.md
docs/test-cases/FP-016-mutual-friend-engagement-visibility.md
```

## Mock 与种子策略（§6）

主验证路径用真实 `DataStore`（临时 SQLite 文件）。种子：V=alice(1)、A=bob(2)、
C=carol(3，V 与 A 的共同好友)、D=dave(4，仅 A 的好友)、E=erin(5，陌生人)；
关注边 V→A、V→C、A→C、A→D（F(V)={A,C}，F(A)={C,D}，共同好友={C}）；
A 的帖子上撒点赞 / 评论（显式时间戳直插 SQLite 保证时序确定），断言 V 只见
C / 自己 / A 的互动，不见 D 与 E 的。另以内存契约替身（仅实现消费的契约方法）
重放核心断言，覆盖「依赖未实现按 §6 模拟」路径。
