# 测试场景 FP-001：核心数据模型与存储

对应验收标准（任务卡 §7）与独立验证方式（§8）。测试文件：`tests/test_storage.py`，运行 `pytest`。

## TC-01 持久化：四表写入 → 重启 → 字段完整（验收 1）

- **前置**：空存储（临时目录新 SQLite 文件）。
- **步骤**：写入用户 1 条（用户名 / 密码散列 / 盐）、帖子 1 条（作者 / 内容 / 创建时间）、关注边 1 条（关注者→被关注者）、会话 1 条；`close()` 后重新打开（等价应用重启）。
- **期望**：
  - `getUserByUsername` / `getUserById` 读回用户，`{id, username, password_hash, salt, created_at}` 全字段与写入一致；
  - 帖子经 `getPostsByAuthorIds({author_id})` 读回，`{id, author_id, content, created_at}` 一致；
  - `followExists(follower, followee) → True`，`getFolloweeIds(follower) → [followee]`；
  - `getSession(token)` 读回 `{user_id, expires_at}`，user_id 一致且 expires_at 为合法时间。

## TC-02 getPostsByAuthorIds 集合完备性（验收 2，种子场景）

- **前置**：种子数据（alice/bob/carol；bob、carol 各 2 帖；alice→bob、alice→carol；token=`seed-token-1`）。
- **步骤**：以作者集合 `{bob.id, carol.id}` 查询。
- **期望**：取回恰 4 帖，每帖 `{id, author_id, content, created_at}` 字段完整，author_id 均属集合（顺序不保证，按 id 集合断言）。

## TC-02a 集合查询边界

- 空集合 → `[]`；不含任何帖子的作者集合 → `[]`；集合含重复 id → 不产生重复帖；混合存在 / 不存在的作者 id → 仅返回存在作者的帖子。

## TC-03 用户名唯一冲突（验收 3）

- **前置**：已存在用户 `alice`。
- **步骤**：再次 `createUser("alice", …)`。
- **期望**：抛 `UsernameAlreadyExistsError`，消息含「用户名已存在」；`getUserByUsername("alice")` 仍只有原账号（id 不变）；`listUsers()` 中 username 无重复。

## TC-04 用户读取接口

- `getUserByUsername` 未命中 → `None`；`getUserById` 未命中 → `None`；`getUserById` 命中 → 与按用户名读取同一条记录。
- `listUsers()` 返回全量用户的 `[{id, username, created_at}]`（含自身，不含 password_hash/salt），至少覆盖已写入的全部用户。

## TC-05 会话：无效 / 过期 / 销毁 → None（验收 §8）

- **无效**：`getSession("不存在的token")` → `None`。
- **销毁**：`createSession` 后 `destroySession(token)` → `getSession` 返回 `None`；对不存在的 token 再次 `destroySession` 幂等不抛错。
- **过期**：`createSession(user_id, ttl=已过期时长)`（ttl≤0 或极短）→ `getSession` 返回 `None`；且过期行被清理后再次查询仍 `None`。
- **有效**：`createSession` 返回 `{token, expires_at}`；token 每次生成互不相同（随机不可预测）；`getSession(token)` 的 `user_id` 正确。

## TC-06 关注：幂等与查询

- `addFollow(a, b)` 两次 → `followExists(a,b)` 仍 `True`，`getFolloweeIds(a)` 恰含一个 `b`（仍为一条边）。
- `followExists` 未建立 / 反向（b→a 未关注）→ `False`。
- `getFolloweeIds` 多关注 → 返回全部被关注者 id；未关注任何人的用户 → `[]`。
- 自关注：`addFollow(a, a)` → 抛 `SelfFollowError`（§3.1 应用层禁止 follower_id = followee_id），不写入。

## TC-07 帖子基本语义

- `createPost` 返回完整帖子对象，`author_id` / `content` 与入参一致，`created_at` 为合法时间，`id` 唯一（多次创建递增互异）。
- 内容不做长度限制（§5）：超 280 字、含空白 / 换行 / Unicode 的内容均可原样存取（校验归 FP-013）。

## TC-08 schema 契约（§3.1）

- 重复初始化同一数据库文件（`DataStore` 二次打开）不报错、不丢数据（`CREATE TABLE IF NOT EXISTS` / 幂等迁移）。
- 索引与唯一约束存在：`users.username` 唯一、`follows(follower_id, followee_id)` 唯一、`sessions.token` 唯一。

## TC-09 种子数据脚本

- `load_seed(store)` / CLI 写入后：3 用户、4 帖（bob 2、carol 2）、2 条关注边、token=`seed-token-1` 会话可读；重复执行幂等（用户名冲突时跳过，不报错、不重复）。

## 运行

```bash
pytest -q
```
