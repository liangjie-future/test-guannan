# FP-008 评论提交动作 — 测试场景

测试运行器：`node --test tests/comment-action.test.js`（`npm test` 自动发现）。

替身策略（任务卡 §6）：
- 评论存取：FP-005 已合入的 `createMemoryInteractionStore`，测试注入
  `comments: []`（空评论种子，其余标准种子：alice(1)/bob(2)/… 帖 P1 归 bob）；
  `getCommentsByPostIds` 作「落库 / 无记录」断言面。
- 会话：仓库既有 `createSessionAccess({ store: createMemorySessionStore() })`，
  种子凭据 `seed-token-1`＝alice(1)；未登录即不带 Cookie。
- 测试文本：`'hello'`（1 字）、`'   '`（全空白）、`'x'.repeat(281)`、
  `'y'.repeat(280)`（恰 280，另配首尾空白变体验证 trim 口径）。

## 单元层（纯函数）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| U1 | `parseCommentActionPath` | `/posts/1/comment` → `1`、`/posts/42/comment` → `42`；`/posts/abc/comment`、`/posts/1/comments`、`/posts/1/comment/x`、`/posts//comment`、`/comment` → `null`（落回 404） |
| U2 | `validateCommentContent` 空态 | `''` / `'   '` / `'\t\n'` → `{status:'ERROR', reason:'EMPTY_CONTENT'}` |
| U3 | `validateCommentContent` 边界 | 281 字 → `TOO_LONG`；恰 280 字 → OK 且 `text` 为 trim 后文本；`'  ' + 280字 + '\n'` → OK（去首尾空白后 280 含边界） |
| U4 | `validateCommentContent` 码点口径 | 141 个非 BMP 字符（282 个 UTF-16 单元）→ OK；281 个 → TOO_LONG |
| U5 | `validateCommentContent` 编程错误 | 非字符串 content 抛 `TypeError` |
| U6 | `commentFailureLocation` | 参数顺序 `comment_failed_post` → `comment_error` → `comment_text`；空格编码 `+`、非保留字符百分号编码；`searchParams.get` 可无损还原原输入 |
| U7 | `createCommentAction` 未注入 createComment | fail-fast 抛错含 `createComment` |

## HTTP 层 — 验收用例（A 组，seed-token-1＝alice）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| A1 | alice POST `/posts/1/comment` `content=hello` | 302 且 `Location: /timeline`；`getCommentsByPostIds([1])` 恰一条、含该条（末位），字段 `post_id=1 / user_id=1 / content='hello'`、`created_at` 非空 |
| A2 | `content='x'.repeat(281)` | 302；`Location` 为 `/timeline` 且查询参数 `comment_failed_post=1`、`comment_error=TOO_LONG`、`comment_text=281 个 x`；`getCommentsByPostIds([1])` 为空 |
| A3 | `content='   '`（全空白） | 302；`comment_error=EMPTY_CONTENT`、`comment_text='   '`（原输入保留的回显数据源）；无记录 |
| A4 | 未登录（无 Cookie）POST | 302 且 `Location: /login`；`getCommentsByPostIds([1])` 为空（无评论记录） |
| A5 | `content='  ' + 'y'.repeat(280)`（去首尾空白后恰 280 码点） | 302 `/timeline`；落库恰一条且 `content` 为 trim 后 280 字（280 含边界） |

## HTTP 层 — 守卫与方法（G 组）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| G1 | 基线兼容（未注入 sessionAccess）：`getCurrentUser` 替身 alice POST | 成功 302 `/timeline` 且落库（端口与替身可独立组装） |
| G2 | 基线匿名（未注入 sessionAccess）POST | 302 `/login`；无记录（POST 动作不放行，与 /compose 同策略） |
| G3 | 已登录 GET `/posts/1/comment` | 405 且 `Allow: POST`；无记录 |
| G4 | 已登录 PUT / DELETE | 405 且 `Allow: POST` |
| G5 | 未登录 GET | 302 `/login`（登录守卫先于方法判定） |

## HTTP 层 — 健壮性（R 组）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| R1 | POST 缺 `content` 字段（空 body） | 归一空串 → 302 `comment_error=EMPTY_CONTENT`（不 500） |
| R2 | 超大请求体（> 64KB） | 413；不触达 store（无记录） |
| R3 | 非 `/posts/<数字>/comment` 形状（`/posts/abc/comment`） | 404（落回既有未找到路径，不误判为动作） |
| R4 | 成功后连续第二条评论 | 落库两条、`created_at` 正序时新评论为末位（读取方排序契约） |
| R5 | XSS 边界——`comment_text` 携带 `<script>` 原输入 | Location 为 URL 编码形式，`searchParams.get` 还原等于原文（编码即防注入面，渲染转义归 FP-006） |

## 既有用例回归

- `tests/server.test.js`、`tests/access-control.test.js`、`tests/compose.test.js`
  等不改动，应全绿（新路由独立分发，不影响既有占位 / 受限页行为）。
