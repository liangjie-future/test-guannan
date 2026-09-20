# 设计笔记 FP-010：全站用户列表页

## 目标

交付全站用户列表页（`/users`）：登录门槛后展示全部存在用户（含自己、自己行有
区分标识且不提供可用关注操作），每行提供关注按钮，点击后以
`(当前用户, 该行用户)` 调用 follow 服务并反馈关注结果 / 更新已关注状态。

## 技术选型与整体形态

- **Node.js（≥18）+ 零第三方依赖**，与 FP-004/005/003 的 Web 侧一致：
  服务端渲染 HTML 内容区挂载进 FP-004 统一布局，`node:test` 验证。
- **无前端 JS**：关注点击 = `<form method="post">` 提交，服务端处理后
  **303 See Other 重定向回 `/users`**（PRG 模式），页面状态由服务端重渲染体现。

## 模块结构

```
src/social-store.js    FP-001/FP-011 契约的 Node 内存适配层（§6 Mock 策略）：
                       createMemorySocialStore() → { getUserById, listUsers,
                       addFollow, followExists, getFolloweeIds }，
                       种子：alice(1)/bob(2)/carol(3)、关注边 alice→bob
src/follow-service.js  FP-011 关注规则的 Node 消费端适配：
                       createFollowService({ store }) →
                       follow(f,g) → {status:'OK', created} | {status:'ERROR', reason}
                       （三态：成功 / 幂等 / 拒绝；语义与 services/follow.py 对齐）
src/users-page.js      FP-010 本体：createUsersPage({ listUsers, follow,
                       getFolloweeIds }) → { renderContent, handleFollowAction }
src/server.js          组装点：createWebServer({ usersPage }) 注入即生效；
                       startServer() 生产组装默认注入（种子内存 store）
tests/social-store.test.js     内存适配层单测
tests/users-page.test.js       页面渲染 / 动作处理单测
tests/user-list-page.test.js   HTTP 层（门槛 / 渲染 / 点击关注 / 边界）
```

## 关键决策

1. **依赖全部注入，Mock 边界清晰**：页面只依赖任务卡 §3.2 契约形状
   （`listUsers` / `follow` / `getFolloweeIds`），测试注入记录型 Mock
   （记录调用 + 三态返回），生产注入内存适配层。跨语言持久化
   （FP-001 Python SQLite）桥接属集成点，替换注入即可，页面逻辑零改动。
2. **follow 返回结果对象而非异常**：Python 侧 FP-011 抛异常，Web 层需要
   可序列化的反馈通道，故 Node 适配为
   `{status:'OK', created:true|false}`（新建 / 幂等）或
   `{status:'ERROR', reason:'SELF_FOLLOW_NOT_ALLOWED'|'FOLLOWEE_NOT_FOUND'}`
   （拒绝自己 / 用户不存在），规则判定顺序与 services/follow.py 一致。
3. **自己行不渲染关注表单**（而非仅禁用按钮）：自关注防线有两层——
   UI 不提供可用操作（自己行只渲染区分标识），服务端 follow 规则兜底
   （直接 POST 自关注 → 拒绝 + 提示「不可关注自己」）。
4. **已关注行按钮保留可点（幂等语义外显）**：按钮随状态换标签
   （未关注「关注」/ 已关注「已关注」，`data-follow-state` 区分），
   重复点击走 FP-011 幂等路径，仍恰一条边。自己行则无按钮。
5. **PRG + notice 查询参数做结果反馈**：POST `/users/:id/follow` →
   303 → `/users?notice=FOLLOW_OK&username=…`（或错误码）；notice 只渲染
   已知码（FOLLOW_OK / SELF_FOLLOW_NOT_ALLOWED / FOLLOWEE_NOT_FOUND /
   FOLLOW_ERROR），未知值忽略，杜绝反射面；username 经 escapeHtml。
6. **访问控制复用 FP-003**：`/users` 已在 RESTRICTED_PATHS；本任务把守卫
   扩展到 `/users/` 前缀（关注动作 POST 路由），匿名 POST 一律 302 `/login`
   且不触达 follow 服务。未注入 sessionAccess 时保持 FP-004 基线占位
   （可注入 currentUser 替身驱动页面，§6 验证形态）。
7. **路由形状**：`POST /users/<id>/follow`，id 限 `\d+`，无请求体解析
   （零依赖、无 CSRF 面之外的新增面；`/users/abc/follow` 不匹配 → 404）。
8. **getFolloweeIds 渲染已关注态**：页面加载时一次取当前用户被关注者集合，
   逐行判定展示（任务卡 §3.2 指定数据来源）。

## 非范围提醒

关注规则判定本体（FP-011，此处仅适配调用）、会话管理（FP-003）、
用户持久化（FP-001，此处内存种子）、统一布局骨架（FP-004）、
取消关注（无此契约，不做）。
