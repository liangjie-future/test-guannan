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

## 开发与测试

```bash
npm test               # Node 端全部测试（node --test：test/ 与 tests/）
pytest                 # FP-001 存储层 Python 测试（pip install pytest）
```
