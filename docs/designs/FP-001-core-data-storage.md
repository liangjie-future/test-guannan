# 设计笔记 FP-001：核心数据模型与存储

## 目标

为 twitter 类社交平台提供用户 / 帖子 / 关注关系 / 会话四类核心数据的持久化存储层与读写接口（§3.2 契约），保证应用重启后数据可读回，并提供「按作者集合取帖」的聚合查询基础能力。

## 技术选型

- **语言**：Python 3（仓库为空仓库、任务卡语言无关；选 Python 3.12 + 标准库，零第三方运行时依赖，便于后续 Web 任务以任意框架接入）。
- **存储**：SQLite（嵌入式单文件数据库，`sqlite3` 标准库自带）。理由：任务卡 §3.3 明确「嵌入式 / 本机持久化——文件、嵌入式库或本机数据库均可」；SQLite 原生提供主键、`UNIQUE` 约束与索引，天然满足 §3.1 的唯一性需求（用户名唯一、关注边唯一、token 唯一），且数据落盘即满足「重启后可读回」。

## 关键决策

1. **DataStore 类封装连接**：`storage.DataStore(path)` 打开（必要时初始化 schema）一个 SQLite 文件；`close()` 后重新 `DataStore(path)` 即等价于「应用重启」，测试以此模拟重启验证持久化。后续任务（FP-002/003/013/015）通过其实例方法消费契约签名。
2. **schema 与 §3.1 一一对应**：
   - `users`：`id INTEGER PRIMARY KEY AUTOINCREMENT`、`username TEXT NOT NULL UNIQUE`、`password_hash` / `salt` / `created_at TEXT NOT NULL`。password_hash/salt 为不透明字段（§5）。
   - `posts`：`author_id REFERENCES users(id)`，`content` 不加长度约束（§5：1–280 校验归 FP-013）；索引 `author_id`、`created_at`。
   - `follows`：复合主键 `(follower_id, followee_id)` 即唯一约束；另建 `follower_id`、`followee_id` 单列索引；外键指向 users。自关注（follower_id = followee_id）在应用层抛 `SelfFollowError`（§3.1「应用层禁止」）。
   - `sessions`：`token TEXT PRIMARY KEY`（`secrets.token_hex(32)` 随机不可预测）、`user_id`、`created_at`、`expires_at`。
   - 每次打开连接执行 `PRAGMA foreign_keys = ON` + `journal_mode = WAL`（读写并发友好）。
3. **时间表示**：统一 UTC ISO 8601 字符串（`datetime.now(timezone.utc).isoformat()`），可读、可排序、跨重启稳定。会话过期判断在 Python 侧解析 `expires_at` 与当前时刻比较，避免字符串比较的格式脆弱性。
4. **错误语义**（§4）：
   - `createUser` 用户名冲突 → 抛 `UsernameAlreadyExistsError`（消息「用户名已存在」），依赖 `users.username` 唯一约束 + 捕获 `IntegrityError`，无竞态窗口。
   - `getSession` 无效 / 过期 / 已销毁 → 一律返回 `None`；读到已过期行时顺手删除（惰性清理）。
   - `addFollow` 幂等：`INSERT OR IGNORE`，重复调用不报错、不产生第二条边。
   - `destroySession` 幂等：不存在的 token 静默成功。
5. **会话有效期**：契约只要求返回 `expires_at`。提供 `createSession(user_id, ttl=None)`，默认 TTL 7 天（`DEFAULT_SESSION_TTL` 常量，FP-003 可按策略传自定义 ttl 或 0 语义外处理）；「浏览器会话级」的 Cookie 属性属 FP-003，存储层不感知。
6. **getPostsByAuthorIds**：入参任意可迭代 id 集合；按 500 个/批拼接 `IN (...)` 参数化查询，保证集合完备（去重入参）、顺序不保证（排序归 FP-015）；空集合直接返回 `[]`。
7. **返回形状严格对齐契约键名**：`getUserByUsername` → `{id, username, password_hash, salt, created_at}`；`listUsers` → `[{id, username, created_at}]`（不含口令散列）；`getSession` → `{user_id, expires_at}`；`createSession` → `{token, expires_at}`。
8. **种子数据**（§6）：`storage/seed.py` 提供 `load_seed(store)` 与 CLI（`python -m storage.seed <db路径>`），写入 alice/bob/carol、bob 与 carol 各 2 帖、alice→bob、alice→carol、token=`seed-token-1` 会话。

## 目录结构

```
storage/
  __init__.py    # 导出 DataStore 与错误类型
  store.py       # schema 初始化 + §3.2 全部接口
  seed.py        # 验证用种子数据（函数 + CLI）
tests/
  test_storage.py
docs/
  designs/FP-001-core-data-storage.md
  test-cases/FP-001-core-data-storage.md
```

## 非范围提醒

密码散列算法（FP-002）、会话策略与访问控制（FP-003）、帖子长度校验（FP-013）、时间线过滤排序（FP-015）均不在本任务实现；本层只做不透明存取与集合完备查询。
