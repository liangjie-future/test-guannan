# 设计笔记 FP-004：互动可见性判定服务

> 来源：FP-004（源 EN-004 互动可见性判定服务 ｜ 业务规则与计算）｜P0 ｜ M2（规则与桥接）｜波次 2
> 任务卡：input/tasks/mutual-friend-interaction-visibility/FP-004-interaction-visibility.task.md

## 目标

新建独立可见性服务 `services/interactions.py::InteractionVisibilityService(store)`：
输入查看者与帖子集合，按可见集公式过滤点赞 / 评论并返回仅可见计数，
作为**全部读取路径的唯一过滤点**（写入路径不经过本服务）。

## 术语与口径（任务卡 §2，唯一依据）

- **好友 X** ＝ 与 X 双向互关者（FP-003 `friendIds` 口径，实时按当前边、无快照）；
- **可见集(V, A)** ＝ `friendIds(V) ∩ friendIds(A) ∪ {V}`；
- 互动者 ∈ 可见集 → 其点赞 / 评论对 V 可见；集外一律不可见；
- **D5 特例**：查看者自身恒在集内（∪{V}）——对自己总可见；
- **帖主自互动自然排除**：帖主不是自己的好友（`SelfFollowError` 禁自关注 ⇒
  无人是自己的好友），按同公式统一处理，不特判；
- **D2 统一口径**：好友帖主与非好友帖主走同一条交集规则；
- **D8**：仅可见计数，不携带任何「存在被隐藏内容」的信息；
- **实时判定**：每次查询按 follows 当前边计算，不做快照。

> 注意与既有 FP-016 `EngagementService` 的口径差异：FP-016 是另一独立特性
> （W(V,A)={V,A}∪单向共同关注），不在本任务范围，互不改动。FP-005 Node
> 侧 Mock 与本任务**契约同形**（见 src/interaction-store.js），两侧公式一致。

## 关键决策

1. **纯读服务、零 SQL**：只经 store 注入消费 FP-001/002/003 三组读契约
   （`getLikesByPostIds` / `getCommentsByPostIds` / `mutualFriendIds`），
   任一满足形状的实现均可替换（测试用 §6 内存 Stub）。
2. **`visibleSet` 直译公式**：`set(store.mutualFriendIds(V, A)) | {V}`——
   `mutualFriendIds` 语义即 `friendIds(V) ∩ friendIds(A)`（FP-003 已冻结），
   外层 `set(...)` 防御性拷贝（不信任注入实现返回独立集合）。
3. **按帖集合批量取数 + 服务端分组过滤**：`getVisibleInteractions` 对整个
   posts 集合各发**一次**批量读（ByPostIds 契约的本意），按 post_id 分组后
   逐帖套可见集过滤；帖子按输入顺序逐条返回（口径同 FP-005 Mock）。
4. **同作者去重计算**：一次调用内对相同 author_id 的可见集做局部缓存
   （互关推导与帖子数解耦，多次同作者帖不重复推导）。
5. **服务端排序为唯一权威**：likes 按 `(真实瞬间, user_id)` 升序、comments
   按 `(真实瞬间, id)` 升序——`_instant` 解析 ISO 8601（naive 视为 UTC），
   跨时区偏移文本按瞬间归一（口径同 FP-015 / FP-016，存储层文档亦把瞬间
   归一显式留给服务层）；过滤发生在排序前，不依赖存储返回顺序
   （likes 契约本就「顺序不保证」）。
6. **投影即副本**：返回条目按契约形状重建（likes→{user_id, created_at}、
   comments→{id, user_id, content, created_at}），天然是浅副本，调用方改动
   不污染注入 store 状态。
7. **读路径无错误分支（自然坍缩）**：可见集为空 → 空列表与 0 计数；
   空帖子集合 → 空返回；返回对象键固定为五键（post_id / likes / comments /
   visible_like_count / visible_comment_count），无任何隐藏量差信息（D8）。

## 接口契约（§4）

```python
from services import InteractionVisibilityService

svc = InteractionVisibilityService(store)   # store 满足 §3.2 三组契约形状
svc.visibleSet(viewer_id, author_id)        # → set：friendIds(V) ∩ friendIds(A) ∪ {V}
svc.getVisibleInteractions(viewer_id, posts)
# posts＝[{id, author_id, …}] → 逐帖（输入顺序）：
#   {post_id, likes: [{user_id, created_at}], comments: [{id, user_id, content,
#    created_at}], visible_like_count, visible_comment_count}
```

## 非范围

- 点赞 / 评论的 HTTP 路由（FP-007 / FP-008 / FP-009）；
- 时间线互动区渲染（FP-006 消费本服务输出形状）；
- Node 侧同形 Mock（FP-005 已合入）；
- 不重构 FP-016 `EngagementService`（另一特性，口径并存）。

## 目录结构

```
services/interactions.py                 # InteractionVisibilityService（本任务唯一实现体）
services/__init__.py                     # 导出 InteractionVisibilityService
tests/test_interactions.py               # 对应 docs/test-cases/FP-004-interaction-visibility.md
docs/designs/FP-004-interaction-visibility.md
docs/test-cases/FP-004-interaction-visibility.md
```

## 种子与验证（§6 / §8）

测试全部走 §6 内存 Stub（不依赖其他任务运行时产出）：用户 alice=1 / bob=2 /
carol=3 / dave=4（另 erin=5 供验收 6，无任何边）；互关边 alice↔bob、
alice↔carol、bob↔carol、bob↔dave（→ 好友(alice)={bob,carol}、
好友(bob)={alice,carol,dave}、共同好友(alice,bob)={carol}）；帖 P1
（author=bob）；点赞 carol / dave / bob（帖主自赞）；评论 c1 carol「+1」(t1)、
c2 dave「同看」(t2)、c3 bob 自评 (t3)、c4 alice「路过」(t4)。
期望（alice 查 P1）：likes={carol}、comments=[c1, c4]、计数 1/2。
解除互关场景经 Stub 直接删边模拟。验证命令：`pytest tests/test_interactions.py`。
