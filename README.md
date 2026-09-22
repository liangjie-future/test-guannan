# test-guannan

twitter 类社交平台（Step 1：注册登录 / 单向关注 / 280 字发帖 / 时间线）。
部署形态：单机、单租户、单环境（FP-005 提供运行载体）。

## FP-005 单机部署与运行

要求 Node.js >= 18（Web 端零第三方依赖，无需 `npm install`）。

```bash
cp .env.example .env   # 可选：按需调整 HOST / PORT / DATA_DIR
./run start            # 启动（守护模式）
curl -i http://127.0.0.1:3000/   # 验证：200 + FP-004 页面骨架
./run stop
```

运行配置仅 `HOST` / `PORT` / `DATA_DIR` 三项（环境变量 > `.env` > 默认值），
`DATA_DIR` 启动时自动创建。启动 / 停止 / 重启 / 状态 / 排障详见
[RUNBOOK.md](RUNBOOK.md)；`npm start` 与 `./run start --foreground` 等价直启。

## FP-001 核心数据模型与存储

嵌入式 SQLite 持久化层（Python 3 标准库，无第三方依赖），提供用户 / 帖子 / 关注关系 / 会话四类数据的读写契约：

```python
from storage import DataStore
from storage.seed import load_seed  # 种子数据（可选）

store = DataStore("social.db")   # 关闭后重新打开即等价应用重启，数据仍可读回
```

接口（任务卡 FP-001 §3.2 共享契约）：`createUser / getUserByUsername / getUserById /
listUsers / createPost / getPostsByAuthorIds / followExists / addFollow /
getFolloweeIds / createSession / getSession / destroySession`；错误类型
`UsernameAlreadyExistsError`（用户名已存在）、`SelfFollowError`（禁止自关注）。

建议将 SQLite 文件置于 `DATA_DIR`（默认 `<仓库根>/data`，如
`DataStore("data/social.db")`），与 FP-005 的数据目录约定保持一致。

种子数据（alice / bob / carol，4 帖，2 条关注边，token=`seed-token-1`）：

```bash
python -m storage.seed social.db
```

## FP-011 关注关系规则

关注服务层（消费 FP-001 存储，仅依赖 §3.2 契约形状，可换内存模拟）：

```python
from services import FollowService, FollowError, SelfFollowNotAllowedError, FolloweeNotFoundError
from storage import DataStore

svc = FollowService(DataStore("data/social.db"))
svc.follow(1, 2)        # 单向边 1→2：无需确认、不自动反向；重复关注幂等
svc.getFollowees(1)     # → [2, ...] 被关注者 id 集合（时间线聚合 / 页面已关注态数据来源）
```

错误语义：自关注抛 `SelfFollowNotAllowedError`（「不可关注自己」）；被关注者不存在抛
`FolloweeNotFoundError`（「用户不存在」）；两者均为 `FollowError` 子类。

## FP-013 发帖内容规则

发帖业务核心服务（`services.PostService`，消费 FP-001 存储）：校验帖子为
1–280 字非空纯文本（去首尾空白后按码点计，上限 280 含边界），通过后落库并
关联作者与创建时间：

```python
from services import PostService
from storage import DataStore

service = PostService(DataStore("data/social.db"))
result = service.createPost(author_id, content)
# 成功：{"status": "OK", "post": {id, author_id, content, created_at}}
# 失败：{"status": "ERROR", "reason": "AUTHOR_NOT_FOUND" | "EMPTY_CONTENT" | "TOO_LONG"}
```

校验顺序：作者存在 → 内容非空 → 长度 ≤ 280；失败不产生帖子记录。
发帖界面（FP-012）与时间线可见性（FP-014 / FP-015）由后续任务消费本契约。

## FP-012 发帖界面

发帖 Web 界面（Node SSR，以内容区挂载进 FP-004 统一布局）：登录门槛
（FP-003 `requireLogin`，匿名 POST 无论何种组装均 302 `/login`）、纯文本
输入 + 发布控件 + 实时字数提示「当前 / 280」（码点口径，与 FP-013 一致）；
提交调用 `createPost` 服务按 §3.2 三态呈现——成功「发布成功」反馈 + 帖子
摘要 + 空表单，失败展示对应原因（内容为空 / 超过 280 字上限（当前 N 字））
且帖子未发布、原输入回显保留：

```js
import { createWebServer } from './src/server.js';
import { createMockPostService } from './src/post-service.js';

const postService = createMockPostService();       // 契约同形 Mock（§6）
createWebServer({ createPost: postService.createPost });  // 端口可注入
```

FP-013 实现产在 Python（`services.PostService`），跨语言桥接属集成点；
默认注入契约同形的内存 Mock（校验语义对齐：去首尾空白、按码点计、280 含
边界、失败不落帖）。验证用输入样例（`hello world` / 空 / 全空白 / 281 字 /
恰 280 字）见 `tests/compose.test.js`。

## FP-015 时间线聚合与排序

时间线业务核心服务（`services.TimelineService`，消费 FP-001 存储）：按全部被关注
用户集合聚合帖子、`created_at` 倒序返回，仅含被关注对象的帖子（不含自己的、不含
未关注者的，上游 D7）；未关注任何人返回空集合：

```python
from services import TimelineService
from storage import DataStore

service = TimelineService(DataStore("data/social.db"))
service.getTimeline(user_id)
# → [{id, author_id, content, created_at, author_username}, ...] 新帖在前
```

排序按真实时间瞬间（ISO 8601 解析，naive 视为 UTC），不依赖存储返回顺序；作者名
由本任务经 `getUserById` 一并补齐（`author_username`），页面（FP-014）无需逐帖回查。

## FP-007 注册规则与建号

注册业务核心服务（`services.RegistrationService`）：校验用户名唯一、密码 ≥6 位，
通过后建号（用户名 + 密码散列 + 盐 + 创建时间，全链路无明文）并进入登录态；
失败不建号、不建会话，并发 / 重复提交由用户名唯一约束兜底（仅一个账号）：

```python
from services import RegistrationService
from storage import DataStore

service = RegistrationService(DataStore("data/social.db"))
result = service.register("newuser", "secret123")
# 成功：{"status": "OK", "user": {id, username}, "session_token": <登录态凭据>}
# 失败：{"status": "ERROR", "reason": "USERNAME_TAKEN" | "PASSWORD_TOO_SHORT"}
```

校验顺序：用户名占用 → 密码长度 → 散列（FP-002 `hashPassword`，慢散列仅
成功路径触达）→ 建号（FP-001）→ 建会话（FP-003 契约 `createSessionOnLogin`，
默认以 `store.createSession` 派生，可注入访问控制层自有工厂）。注册页输入
收集与展示（FP-006）消费本契约。验证用种子（已占用 `alice`、合法
`newuser`/`secret123`、过短 `12345`）见 `tests/test_registration.py`。)

## FP-002 密码加密存储

单向慢散列 + 独立随机盐的纯能力接口（Python 标准库，零第三方依赖），
供注册建号（写入侧）与登录校验（比对侧）消费：

```python
from security import hashPassword, verifyPassword

creds = hashPassword("password123")     # → {"hash": <hex>, "salt": <hex>}，明文不入库
store.createUser("alice", creds["hash"], creds["salt"])

row = store.getUserByUsername("alice")
verifyPassword("password123", row["salt"], row["password_hash"])  # → True
```

算法 PBKDF2-HMAC-SHA256，600,000 次迭代（OWASP 现行建议值），盐为 CSPRNG
128 bit、每次独立生成；比对用 `hmac.compare_digest` 恒时比较。模块零日志，
返回值不含明文（不落盘 / 不进日志 / 不进响应的检查口径见
docs/designs/FP-002-password-hash.md）。验证用种子用户
（`seed-password-a` / `seed-password-b`，明文样例 `password123` / `hunter2`）：

```bash
python -m security.seed data/social.db
```

## FP-003 会话管理与访问控制

登录成功建会话（Cookie `session_token` 下发，HttpOnly / SameSite=Lax，TTL 7 天）、
过期 / 退出即失效、未登录访问受限页（用户列表 / 发帖 / 时间线）302 跳转 `/login`：

```js
import { createSessionAccess } from './src/session-access.js';
import { createMemorySessionStore } from './src/session-store.js';

const sessionAccess = createSessionAccess({ store: createMemorySessionStore() });
sessionAccess.createSessionOnLogin(userId); // → {token, expires_at}（Set-Cookie 用 sessionCookie()）
sessionAccess.currentUser(request);          // → {id, username} | null
sessionAccess.requireLogin(request, res);   // 已登录放行；未登录 302 → /login
sessionAccess.logout(token);                // 销毁会话（幂等）
```

存取原语按 FP-001 §3.2 契约（`createSession / getSession / destroySession /
getUserById`）注入；默认内存实现含种子：alice（id=1）、有效会话 `seed-token-1`、
过期会话 `seed-token-expired`。`./run start` 生产入口默认启用访问控制
（受限页匿名 302 `/login`，`GET /logout` 销毁会话并清除 Cookie）。

## FP-009 登录校验

登录业务核心服务（`services.LoginService`，消费 FP-001 存储 + FP-002 散列校验，
会话建立走注入式 `createSessionOnLogin`）：

```python
from services import LoginService
from storage import DataStore

svc = LoginService(DataStore("data/social.db"))
svc.login("bob", "right-password")
# 成功：{"status": "OK", "user": {"id", "username"}, "session_token": <登录态凭据>}
# 失败：{"status": "ERROR", "message": "用户名或密码错误"}（统一提示，不建立会话）
```

用户名不存在与密码错误响应完全一致（防账号枚举）：失败路径同样执行一次真实
PBKDF2 比对（诱饵凭证，时序均衡），且任何失败都不产生会话（sessions 表不增长）。
会话建立默认适配 FP-001 `createSession` 原语（FP-003 实现产在 Node，跨语言
按契约形状适配，联调时替换注入即可）；验证用种子用户 bob / 明文
`right-password`（测试内经 `hashPassword` 建号，明文不入库）。

## FP-006 注册页

注册页 `/register`（Node Web 层，挂载进 FP-004 统一布局）：收集用户名 / 密码
提交注册，按 §3.2 契约调用可注入的 register 服务并呈现结果——成功下发会话
Cookie（HttpOnly / SameSite=Lax / TTL 7 天）并 302 跳转 `/timeline`（注册成功
即进入登录态）；失败 200 重渲染表单并给出原因文案（「用户名已存在」/
「密码过短」），无任何「已注册」视觉暗示、不下发 Cookie：

```js
import { createWebServer } from './src/server.js';
import { createMockRegisterService } from './src/register-service.js';

// §6 可注入 Mock：有状态内存实现（初始为空），三态返回
// "alice"/"secret123" 首次 OK、再次 USERNAME_TAKEN；"newuser"/"12345" 过短
const registerService = createMockRegisterService({
  // 可选：桥接 FP-003 会话（./run start 生产组装默认桥接，注册后时间线即见已登录导航）
  createSessionOnLogin: (userId) => sessionAccess.createSessionOnLogin(userId).token,
});
const server = createWebServer({ registerService }); // GET/POST /register 即生效
```

页面侧仅做输入完备性守卫（缺失不触达服务）；用户名唯一 / 密码长度等规则判定
与建号由 FP-007 `RegistrationService` 承担（跨语言联调时按契约形状替换注入），
验证用例见 `tests/register-page.test.js`。

## FP-008 登录页与退出入口

Web 层登录页与退出回路（`src/login-page.js` 表单渲染 + `src/server.js` POST
`/login` 提交处理）：页面只收集输入并调用注入式 login 服务（§3.2 契约
`{status: OK, user, session_token}` / `{status: ERROR, message}`）；成功经
FP-003 `createSessionOnLogin` 建会话、下发 HttpOnly Cookie 并 302 `/timeline`，
失败 200 回渲染统一错误提示（不区分用户名 / 密码哪项错）；导航「退出」入口
已登录可见，点击即销毁会话回登录页：

```bash
./run start
# 浏览器打开 http://127.0.0.1:3000/login → 输入 bob / right-password（§6 Mock 种子）
# → 跳转时间线（已登录导航态）→ 点「退出」→ 回未登录态
```

FP-009 产在 Python，Node Web 进程按契约以 `src/login-mock.js` 的可注入 Mock
替代（bob / `right-password` OK 态、任意错误组合统一失败态）；真实桥接属
集成点（`createWebServer({ login })` 替换注入即可，页面 / 流程零改动）。

## FP-010 全站用户列表页

登录门槛后的全站找人页（上游 D4：全站用户列表，无搜索）：展示全部存在用户
（含自己，自己行有区分标识且不提供可用关注操作），每行关注按钮点击后调用
follow 服务并经 PRG 反馈关注结果 / 更新已关注状态：

```js
import { createUsersPage } from './src/users-page.js';
import { createMemorySocialStore } from './src/social-store.js';
import { createFollowService } from './src/follow-service.js';

const store = createMemorySocialStore();          // 种子：alice/bob/carol，alice→bob
const followService = createFollowService({ store });
const usersPage = createUsersPage({
  listUsers: store.listUsers,                      // FP-001 契约注入
  follow: followService.follow,                    // FP-011 契约注入（三态结果）
  getFolloweeIds: followService.getFolloweeIds,
});
createWebServer({ sessionAccess, usersPage });     // GET /users + POST /users/:id/follow
```

`follow(f, g)` 返回 `{status:'OK', created}`（新建 / 幂等）或
`{status:'ERROR', reason}`（`SELF_FOLLOW_NOT_ALLOWED` / `FOLLOWEE_NOT_FOUND`），
规则语义与 Python 侧 `services/follow.py` 一致；自己行不渲染关注表单，
直连自关注 POST 由服务端规则兜底拒绝。匿名访问（含关注动作）302 `/login`
（FP-003 守卫）。`./run start` 生产入口默认注入（种子内存 store，
`seed-token-1` 即 alice 会话）。

## FP-014 时间线页面

时间线页面（登录后首页 / 默认落点，`src/timeline.js`）：聚合呈现全部被关注对象的帖子
（作者 / 内容 / 发布时间），按 `getTimeline` 服务返回顺序原样渲染（倒序由 FP-015 保证，
页面不重排）；未关注任何人显示空态提示「还没有关注任何人」并引导去用户列表：

```js
import { createTimelinePage, createMockGetTimeline } from './src/timeline.js';

const page = createTimelinePage({ getTimeline });  // getTimeline(user_id) → [post]（FP-015 契约）
page.render({ id, username });                     // → 时间线内容区 HTML（挂载进 FP-004 统一布局）
```

- 登录门槛：`/timeline` ∈ FP-003 `RESTRICTED_PATHS`（未登录 302 `/login`）；
- 默认落点：已登录访问 `/` 302 → `/timeline`（未登录保持 FP-004 演示页）；
- `getTimeline` 构造注入，未桥接前默认 §6 Mock（场景 A：B/C 各 2 帖倒序种子流；
  场景 B：空集合供空态验证），联调时替换注入即可。

```bash
curl -i -H 'Cookie: session_token=seed-token-1' http://127.0.0.1:3000/timeline
```)

## FP-016 好友帖子的点赞评论共同好友可见性

互动服务（`services.EngagementService`，消费 FP-001 存储）：点赞 / 评论写入 +
可见性规则——每个用户查看好友帖子时，只能看到自己与帖子作者**共同好友**的
点赞和评论（共同好友 = 双方都关注的人，与时间线「好友 = 被关注者」同口径；
查看者本人与帖主自身的互动始终可见，微信朋友圈「朋友点赞评论可见」语义）：

```python
from services import EngagementService
from storage import DataStore

svc = EngagementService(DataStore("data/social.db"))
svc.like(user_id, post_id)            # → {status: OK, created} | {status: ERROR, reason}
svc.comment(user_id, post_id, "hi")   # → {status: OK, comment}  | {status: ERROR, reason}
svc.getVisibleEngagement(viewer_id, post_id)
# → {"post_id", "likes": [{post_id, user_id, username, created_at}, ...],
#     "comments": [{id, post_id, user_id, username, content, created_at}, ...]}
```

评论内容规则与发帖同口径（去首尾空白、按码点计 1–280 字）；点赞幂等
（重复返回 `created: False`）；错误 `USER_NOT_FOUND` / `POST_NOT_FOUND` /
`EMPTY_CONTENT` / `TOO_LONG`，失败不落记录。可见性每次查询按关注图实时计算
（新关注立即生效），可见条目按 `created_at` 真实瞬间升序并补全 `username`；
帖子不存在 → 两组皆空（查询无错误分支，口径同 FP-015）。存储层同步扩展
likes / comments 两表与 `getPostById` / `addLike` / `getLikesByPostId` /
`addComment` / `getCommentsByPostId` 五原语（FP-001 契约追加）。页面集成与
时间线条目挂载为后续消费面，验证用例见 `tests/test_engagement.py`。

## FP-008 评论提交动作

评论动作路由（`src/comment-action.js`，`POST /posts/<id>/comment`，命名对齐
FP-010 关注动作风格）：登录守卫先行（未登录 302 `/login`、无评论记录），
校验口径与发帖链路完全一致（去首尾空白后非空、按 Unicode 码点计 1–280 含
边界），成功 `createComment` 落库（trim 后文本）并 PRG 302 回 `/timeline`；
失败不落库，302 携回显参数回跳，供 FP-006 时间线互动区渲染：

```
/timeline?comment_failed_post=<postId>&comment_error=EMPTY_CONTENT|TOO_LONG&comment_text=<URL 编码原输入>
```

```js
import { createWebServer } from './src/server.js';
import { createMemoryInteractionStore } from './src/interaction-store.js';

const store = createMemoryInteractionStore({ comments: [] });  // FP-005 内存实现
createWebServer({ createComment: store.createComment });       // 端口可注入
```

`createComment` 为 FP-002 §3.2 契约端口（Node 侧由 FP-005 内存 store 默认
提供，Python SQLite 桥接属集成点，替换注入即收口）；非 POST 请求 405
（`Allow: POST`）、请求体上限 / 缺字段归一复用 `readFormBody` 口径；不提供
回复 / 嵌套 / 编辑 / 删除路径（上游 D7）。验证用例（验收 1–5 对应 A 组）
见 `tests/comment-action.test.js`。

## FP-009 互动服务端强制过滤与鉴权兜底

安全收口层：全部互动读取与写入路径置于登录守卫之后，可见性过滤固定在
服务端数据组装层（`src/timeline-interactions.js`）——/timeline 互动区数据
唯一来源为注入可见性服务的 `getVisibleInteractions` 输出（FP-004 §3.2-1
契约；组装层只在其上补齐 `username` / `viewer_liked` 渲染便利字段，不
import 任何互动明细存取原语，「绕过过滤直取明细」由构造排除）；两个互动
动作路由以路径模式（`/posts/<id>/like`、`/posts/<id>/comment`）前置
`requireActionLogin`（未登录 / 会话失效一律 302 `/login` 且不产生互动记录，
守卫先于方法检查与存储触达）。响应体红线（D8）：无被隐藏互动条目、无
计数差（计数＝可见数）、无占位、无时序空洞——服务端兜底，不依赖前端隐藏。

```js
import { createWebServer } from './src/server.js';
import { createMemoryInteractionStore } from './src/interaction-store.js';

const store = createMemoryInteractionStore();   // §6 标准场景种子
createWebServer({
  interactionVisibility: store,                 // 读取过滤（注入即生效）
  likeStore: store,                             // 写入动作（FP-007）
  createComment: store.createComment,           // 写入动作（FP-008）
});
```

未注入 `interactionVisibility` 时 /timeline 保持 FP-014 纯帖子流基线；
`startServer` 生产组装默认注入同一 FP-005 内存 store（写读同一数据面）。
终态互动区样式归 FP-006（此处仅提供 data-testid / data-count 钩子的最小
呈现）。验证用例（验收 1–5 + 组装层单元面）见
`tests/interaction-enforcement.test.js`。

## 开发与测试

```bash
npm test               # Node 端全部测试（node --test：test/ 与 tests/）
pytest                 # FP-001 存储层 Python 测试（pip install pytest）
```
