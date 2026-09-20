# FP-012 发帖界面 — 测试场景

测试运行器：`node:test`（`npm test` 自动发现）。
替身策略（任务卡 §6）：`createPost` 用可注入 Mock（契约同形，`posts` 数组作
「帖子未发布」断言面）；`currentUser` 用替身（固定 alice：`{id:1, username:"alice"}`）；
布局用 FP-004 统一布局（已合入，直接消费）。

## Mock 契约（tests/compose.test.js · M 组）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| M1 | `hello world`（11 字）→ OK | `{status:"OK", post:{id, author_id, content, created_at}}` 字段齐全；`posts` 增长 |
| M2 | 空态：`""` 与 `"   "` | 均 `{status:"ERROR", reason:"EMPTY_CONTENT"}`；`posts` 不增长 |
| M3 | 边界：281 字 / 恰 280 字 | 281 → `TOO_LONG`；280 → OK（上限含边界） |
| M4 | 字数口径=码点 | 141 个非 BMP 字符（282 个 UTF-16 单元）→ OK；281 个 → TOO_LONG（排除 UTF-16 单元口径） |
| M5 | 编程错误与副作用 | 失败路径 `posts` 恒不增长；非字符串 `content` 抛 `TypeError` |
| M6 | `countCodePoints` 单元 | `""`→0、ASCII→长度、`a𝕒b`→3（代理对计 1） |

## 界面渲染（HTTP 层，currentUser 替身=alice）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| C1 | GET `/compose` | 200 + `text/html`；统一布局（header/footer）；`textarea[name="content"]`、发布控件（`data-testid="publish-button"`）、字数提示 `0 / 280`（`data-testid="char-counter"`）；表单 `method="post" action="/compose"` |
| C8 | 实时字数机制 | 随表单下发 `input` 事件监听脚本（`addEventListener('input'`）；计数器含 `data-max="280"` 且初值来自服务端计数 |
| C2 | 提交 `hello world` → Mock OK | 页面含「发布成功」（`data-result="OK"`）与帖子摘要；Mock 落帖 `author_id=1, content="hello world"` |
| C5 | 提交恰 280 字 | 发布成功（上限内 OK 态）；落帖内容为 280 字原文 |
| C3 | 提交 281 字 → TOO_LONG | `data-reason="TOO_LONG"`、文案含「超过 280 字上限（当前 281 字）」；输入保留回显；Mock `posts` 为空（帖子未发布） |
| C4 | 提交 `""` / `"   "` → EMPTY_CONTENT | `data-reason="EMPTY_CONTENT"`、文案含「内容为空」；Mock `posts` 为空 |
| C6 | 失败重渲染计数同步 | 281 字回显页计数器为 `281 / 280`；281 个非 BMP 字符（562 UTF-16 单元）亦计 `281 / 280`（码点口径） |
| C7 | XSS 边界 | 成功摘要与失败回显中 `<script>` / `<img onerror>` 均被转义；页面无原始注入串 |

## 登录门槛（FP-003 挂载）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| G1 | 会话态贯通：有效凭据 POST | 200「发布成功」；Mock 落帖 `author_id=1`（alice） |
| G2 | 匿名 POST（注入 sessionAccess） | 302 → `/login`；Mock `posts` 为空（不触达发帖服务） |
| G3 | 基线兼容（未注入 sessionAccess） | 匿名 GET `/compose` 仍 200（FP-004 基线）；匿名 POST 仍 302 `/login` |

## 输入健壮性

| # | 场景 | 断言要点 |
| --- | --- | --- |
| R1 | POST 缺 `content` 字段（空 body） | 视为空串 → EMPTY_CONTENT，不报错 |
| R2 | `PUT /compose` 等其他方法 | 405；`Allow` 含 GET 与 POST |
| R3 | 超大请求体（> 64KB） | 413；不触达发帖服务（Mock `posts` 为空） |

## 既有用例回归

- `tests/server.test.js` S2 调整：`/compose` 由占位页改为 FP-012 实页
  （断言 `compose-form` 存在），其余占位页断言不变。
- `tests/access-control.test.js` H1–H9（受限页守卫、基线可达）不改动，应全绿。
