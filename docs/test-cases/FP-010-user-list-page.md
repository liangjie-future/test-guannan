# 测试场景 FP-010：全站用户列表页

对应验收（任务卡 §7）：
- A-展示：登录态 alice + 种子 3 用户 → 全部 3 个用户可见（含自己，自己行有区分标识）；
- B-关注：bob 行点击关注 → 以 (1, 2) 调用 follow 服务，页面反馈关注生效；
- C-自关注：自己（alice）行不提供可用关注操作（无按钮 / 表单）。

补充验证（任务卡 §8）：未登录经 requireLogin 跳转登录页；点击后 follow Mock
收到正确参数且页面状态更新。

## 一、内存适配层（tests/social-store.test.js，= §3.2 契约消费端）

| # | 场景 | 期望 |
| --- | --- | --- |
| U1 | 种子 listUsers() | 恰 3 行 alice(1)/bob(2)/carol(3)，含 `created_at`，按 id 升序，返回副本（改返回值不影响内部状态） |
| U2 | 种子关注边 | `getFolloweeIds(1)` → `[2]`；bob 未关注任何人 → `[]`；未知用户 → `[]` |
| U3 | addFollow 建边 | `followExists(2,3)` false → add → true；`getFolloweeIds(2)` → `[3]` |
| U4 | addFollow 幂等 | 同一边重复 add 两次 → `getFolloweeIds` 仍恰一个该 id（不重复） |
| U5 | getUserById | 1 → alice；999 → null |
| U6 | 边不反向 | add(2,3) 后 `followExists(3,2)` 仍 false（单向） |

## 二、follow 服务适配（tests/social-store.test.js 续）

| # | 场景 | 期望 |
| --- | --- | --- |
| F1 | follow(3,2) 未关注 | `{status:'OK', created:true}`；边 3→2 落库 |
| F2 | follow(2,3) 种子已关注 | `{status:'OK', created:false}`（幂等）；仍恰一条边 |
| F3 | follow(1,1) 自关注 | `{status:'ERROR', reason:'SELF_FOLLOW_NOT_ALLOWED'}`；不产生边 |
| F4 | follow(1,999) 被关注者不存在 | `{status:'ERROR', reason:'FOLLOWEE_NOT_FOUND'}`；不产生边 |
| F5 | getFolloweeIds(1) | `[2]`（页面已关注态数据来源） |

## 三、页面渲染与动作处理（tests/users-page.test.js，纯函数级）

| # | 场景 | 期望 |
| --- | --- | --- |
| P1 | alice + 种子渲染 | 3 个用户名全部出现；每行 `data-user-id`；表格在统一布局内容区形状（`<section>` 包裹） |
| P2 | 自己行区分标识 | alice 行 `data-self="true"` + 可见徽标（我）；bob/carol 行无该标识 |
| P3 | 自己行无可用关注操作 | alice 行内无 `<form`/`<button`；bob/carol 行均有关注按钮 |
| P4 | 已关注态 | bob 行按钮 `data-follow-state="following"` 标签「已关注」；carol 行 `not-following` 标签「关注」 |
| P5 | 关注动作 | `handleFollowAction({currentUser:alice, followeeId:3})` → 以 (1,3) 调用注入 follow；返回 303 目标 `/users?notice=FOLLOW_OK&username=carol` |
| P6 | 自关注动作（服务端兜底） | followeeId=1 → follow 收到 (1,1)；返回 notice SELF_FOLLOW_NOT_ALLOWED |
| P7 | 不存在用户动作 | followeeId=999 → notice FOLLOWEE_NOT_FOUND |
| P8 | notice 渲染 | searchParams notice=FOLLOW_OK&username=carol → 提示「已关注 carol」；未知 notice 码 → 不渲染提示（无反射） |
| P8b | notice 原型链键 | notice=__proto__/constructor/valueOf/toString → 不抛错、不渲染提示（Object.hasOwn 守卫，防继承键命中） |
| P9 | username XSS | 渲染含 `<script>` 的用户名 / notice username → 被转义 |
| P10 | 空列表 | listUsers 返回 [] → 渲染空态文案不崩溃 |

## 四、HTTP 层（tests/user-list-page.test.js，createWebServer({ sessionAccess, usersPage })）

| # | 场景 | 期望 |
| --- | --- | --- |
| H1 | 匿名 GET `/users` | 302 → `/login`（requireLogin，FP-003 装配） |
| H2 | 已登录 GET `/users` | 200 + 统一布局；3 用户全展示；alice 行有自己标识且无关注按钮；bob 行「已关注」；carol 行「关注」 |
| H3 | 已登录 POST `/users/3/follow` | 303 → `/users?notice=FOLLOW_OK&username=carol`；follow Mock 收到 (1,3)；随后 GET `/users` carol 行变「已关注」 |
| H4 | 已登录 POST `/users/2/follow`（已关注，幂等） | 303 OK 反馈；边仍恰一条（getFolloweeIds 去重） |
| H5 | 已登录 POST `/users/1/follow`（自关注） | 303 notice SELF_FOLLOW_NOT_ALLOWED；GET 后提示「不可关注自己」；不产生自环边 |
| H6 | 已登录 POST `/users/999/follow` | 303 notice FOLLOWEE_NOT_FOUND；无边产生 |
| H7 | 匿名 POST `/users/3/follow` | 302 → `/login`；follow Mock 零调用 |
| H8 | GET `/users/3/follow`（方法不符） | 405（Allow: POST） |
| H9 | 非数字 id `/users/abc/follow` POST | 404（统一布局） |
| H10 | currentUser 替身（无 sessionAccess，§6 形态） | 注入固定 alice 的 getCurrentUser + usersPage → 200 渲染 3 用户 |
| H11 | 未注入 usersPage 的 FP-004 基线 | `/users` 仍返回占位内容（既有用例零破坏） |
| H12 | 已登录 GET `/users?notice=__proto__` | 200 且无 `data-notice`（未知码忽略不变量，防 500/垃圾渲染） |

## 五、既有回归

- `npm test` 全量（FP-004/005/003 既有用例）+ pytest 全量不回归；
  `tests/server.test.js` S2 的 `/users` 占位断言基于未注入 usersPage 的基线，保持通过。
