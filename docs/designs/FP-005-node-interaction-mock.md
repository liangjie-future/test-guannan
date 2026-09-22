# 设计笔记 FP-005：互动与可见性服务 Node 侧 Mock

> 任务卡：input/tasks/mutual-friend-interaction-visibility/FP-005-node-interaction-mock.task.md
> （与 docs/designs/FP-005-single-machine-deploy.md 属两条编号轨道，互不相干）

## 目标

沿仓库既有「契约同形内存 Mock + 注入替换」模式（src/social-store.js、
src/session-store.js、src/post-service.js 同模式），为点赞 / 评论存取与
可见性判定提供 Node 侧内存实现与可注入种子：Web 层（FP-006 时间线内嵌
互动区、FP-007/008 动作路由）开发与测试经注入使用；联调时替换注入即可
切到真实桥接实现，Web 逻辑零改动。

## 契约口径（任务卡 §2/§3，唯一实现依据）

- **好友 X** = 与 X 双向互关的人（两条单向边同时存在），
  `friendIds(X)` 升序返回。
- **可见集** `S(V, A) = (好友(V) ∩ 好友(A)) ∪ {V}`：
  - 查看者 V 自身恒可见（D5 特例）；
  - 帖主 A **不在**集合内——帖主自互动自然排除（与 FP-016 的
    W(V,A)={V,A}∪… 口径不同，以本卡为准）；
  - 空可见集 → 空列表与 0 计数；仅可见计数、无泄露提示（D8）。
- 互动者 ∈ 可见集则其点赞 / 评论对 V 可见；其余一律不可见。

## 关键决策

1. **纯内存、零依赖**：内部 Map（likes 按 `(post_id, user_id)` 复合键、
   comments 按 id、followEdges 按 follower→Set(followee)）+ Set；所有
   返回值一律为浅副本，注入的种子在构造时防御性拷贝（防外部篡改内部
   状态，风格对齐 social-store.js）。
2. **posts 查询时传入**：任务卡种子入参只有
   `{ users, followEdges, likes, comments }`（无 posts 表）——帖子归属
   归 FP-015 时间线；`getVisibleInteractions(viewerId, posts)` 的
   `posts` 为 `[{id, author_id}, …]` 形状，逐帖按输入顺序返回一条结果
   （无互动也返回空数组 + 0 计数条目，空态可模拟）。
3. **确定性排序**：评论按 `created_at` 时间瞬间升序、同时刻按 id 升序
   （任务卡明文）；点赞同为 `created_at` 升序、同时刻按
   `(post_id, user_id)` 升序（任务卡未指定，本实现取确定口径）；
   `getLikesByPostIds` / `getCommentsByPostIds` 跨帖结果全局按同口径排序。
4. **写原语语义**：`likePost` / `unlikePost` 幂等、无返回值（契约未定义
   返回形状，可观测状态经 `getLikesByPostIds` 断言）；`createComment`
   id 自增（从种子最大 id 续起）并返回完整评论副本；**内容校验不在本层**
   （去空白 / 280 上限归 FP-008 路由），原样存储。
5. **可注入时钟**：`now` 可选注入（默认 `new Date().toISOString()`），
   供测试以固定时钟确定性地验证幂等与时序（口径同 session-store /
   post-service）。
6. **种子策略（§6）**：默认种子＝标准场景——用户 alice=1 / bob=2 /
   carol=3 / dave=4；互关边 alice↔bob、alice↔carol、bob↔carol、
   bob↔dave；帖 P1（bob，查询时传入）；点赞 carol / dave / bob→P1；
   评论 c1 carol(t1) / c2 dave(t2) / c3 bob(t3) / c4 alice(t4)。
   显式传入空种子（`[]`）即空态——不回落默认（`??` 仅接住 null/undefined，
   与 social-store 一致）。
7. **users 表仅作领域注册表**：八个契约方法均不消费用户表（可见性完全由
   关注边推导）；入参保留 `users` 以对齐种子形状，供后续任务（如 FP-006
   用户名补全）扩展，不在本层发明过滤语义。

## 接口

```js
import { createMemoryInteractionStore } from './src/interaction-store.js';

const store = createMemoryInteractionStore();          // 默认标准场景种子
const empty = createMemoryInteractionStore({
  users: [], followEdges: [], likes: [], comments: [], // 显式空种子 → 空态
});
const custom = createMemoryInteractionStore({ users, followEdges, likes, comments });

store.likePost(postId, userId);                        // 幂等，无返回
store.unlikePost(postId, userId);                      // 幂等，无返回
store.getLikesByPostIds(postIds);                      // → [{post_id, user_id, created_at}]
store.createComment(postId, userId, content);          // → {id, post_id, user_id, content, created_at}
store.getCommentsByPostIds(postIds);                   // → [{id, post_id, user_id, content, created_at}]
store.friendIds(userId);                               // → [userId]（双向互关，升序）
store.mutualFriendIds(v, a);                           // → [userId]（交集，升序）
store.getVisibleInteractions(viewerId, posts);         // → [{post_id, likes, comments,
                                                       //     visible_like_count, visible_comment_count}]
```

替换注入零改动切换：消费方仅依赖上述八个方法的签名 / 返回形状，注入任一
契约同形实现（含真实桥接）行为一致（验收 2，以测试内第二实现可测化）。

## 非范围

- 不做跨语言真实桥接（集成点：替换注入即可）；
- 不做可见性规则最终真实现（FP-004 Python 侧负责，本任务只保证契约同形）；
- 不做页面渲染与动作路由（FP-006 / FP-007 / FP-008 消费）。

## 目录结构

```
src/interaction-store.js     # createMemoryInteractionStore（八个契约方法）
tests/interaction-store.test.js  # 对应 docs/test-cases/FP-005-node-interaction-mock.md
docs/designs/FP-005-node-interaction-mock.md
docs/test-cases/FP-005-node-interaction-mock.md
```

## 验证

```bash
node --test tests/interaction-store.test.js
```
