# 测试用例 FP-009：互动服务端强制过滤与鉴权兜底

对应实现：`src/timeline-interactions.js`、`src/server.js`（interactionVisibility
注入 + 动作守卫）、`src/timeline.js`（互动区内嵌）。
测试文件：`tests/interaction-enforcement.test.js`（HTTP 级，createWebServer +
临时端口真实请求）。

## 种子（§6，与 FP-004 §6 同构）

- 用户：alice=1 / bob=2 / carol=3 / dave=4；互关边 alice↔bob、alice↔carol、
  bob↔carol、bob↔dave。
- 帖 P1（bob）：点赞 carol(t) / dave(t+1) / bob(t+2)；评论 c1 carol「好帖，顶一个」、
  c2 dave「路过支持」、c3 bob「谢谢大家」、c4 alice「写得太好了」。
- 可见集：dave 看 P1 → 好友(dave)∩好友(bob)=∅ → 仅 {dave}；
  alice 看 P1 → 好友(alice)∩好友(bob)={carol} → {alice, carol}。
- 会话：seed-token-1=alice；dave-token=dave（createSessionOnLogin(4)）；
  seed-token-expired=过期 alice 会话。
- 时间线 Mock：getTimeline 恒返回 [P1(bob)]（避免 carol 作者名干扰全局
  用户名缺席断言）。

## 用例（映射任务卡验收 1–5）

### A. 读取守卫回归（验收 1）

- **AC1-a** 无 Cookie GET /timeline → 302 /login。
- **AC1-b** 过期 token（seed-token-expired）GET /timeline → 302 /login。
- **AC1-c** 无效 token（session_token=nope）GET /timeline → 302 /login。

### B. 写入动作守卫（验收 2）

- **AC2-a** 未登录（无 Cookie）POST /posts/1/like → 302 /login 且
  点赞记录与种子一致（未新增 / 未变更）。
- **AC2-b** 未登录 POST /posts/1/comment（合法内容）→ 302 /login 且
  评论记录与种子一致（未落库）。
- **AC2-c** 过期 / 无效 token 对两个动作同样 302 /login、store 无新记录
  （会话失效视同匿名）。

### C. 读取强制过滤——dave 视角（验收 3）

- **AC3-a** dave GET /timeline → 200；互动区可见点赞恰 1 条（dave，
  viewer_liked 标记）、可见评论恰 1 条（dave「路过支持」）。
- **AC3-b** 响应不含 carol / alice 用户名（帖作者 bob 除外）与被隐藏
  评论内容（「好帖，顶一个」「谢谢大家」「写得太好了」）。
- **AC3-c** 正向对照（alice，seed-token-1）：可见点赞={carol}、可见评论=
  {c1 carol, c4 alice}——证明过滤按规则而非一刀切隐藏。

### D. 无存在性泄露（验收 4）

- **AC4-a** 计数＝可见数：dave 视角 data-like-count=1 / data-comment-count=1
  （alice 视角 1 / 2），无任何“总互动数”或差值字段。
- **AC4-b** 无占位 / 无时序空洞：互动区无“还有 N 条”“部分互动不可见”
  类提示；可见评论按服务返回正序连续渲染。
- **AC4-c** dave 视角 HTML 源码全量断言：不出现被隐藏者任何痕迹
  （用户名 / 内容 / 计数 / 占位符）。

### E. 不可绕过（验收 5）

- **AC5-a** dave GET /posts/1/like、GET /posts/1/comment → 405（Allow:
  POST），响应不含互动数据。
- **AC5-b** 构造的互动数据访问路径 GET /posts/1/comments、/posts/1、
  /api/posts/1/comments → 404，响应体不含被隐藏互动内容。
- **AC5-c** 数据源唯一性（spy 可见性服务）：注入记录调用的 Mock
  可见性服务 → 渲染 HTML 恰含其输出（且仅其输出）、以 (viewer.id,
  posts) 批量调用——证明组装只消费 getVisibleInteractions。

### U. 组装层单元面（补充）

- **U1** assemble 形状：likes 条目含 username / viewer_liked，
  comments 条目含 username；计数与条目数一致。
- **U2** getUserById 缺失 / 未知用户 → username 回落 `用户#<id>`，
  可见条目仍渲染（回落不引入隐藏信息）。
- **U3** 无互动帖 / 空帖子流 → 0 计数 + 空列表，不抛错、无占位。

## 验证命令

```
node --test tests/interaction-enforcement.test.js
```
