# 测试场景 FP-007：注册规则与建号

对应验收标准（任务卡 §7）与独立验证方式（§8）。测试文件：`tests/test_registration.py`，运行 `python3 -m pytest -q`。

种子约定（§6）：已占用用户名 `alice`（散列占位记录）；合法输入 `newuser` / `secret123`；过短输入 `12345`。每组场景分别在真实 `DataStore`（FP-001 SQLite）与内存契约替身（users Map + 锁保证的用户名唯一约束 + 种子 token 会话）上执行，验证服务只依赖 §3.2 契约形状。多数用例注入快速散列替身（确定性摘要、不含明文）控制套件时长；真实 FP-002 慢散列路径在 TC-01 / TC-08 专测。

## TC-01 成功注册建号（验收 1）

- **前置**：空存储（`alice` 未占用）。
- **步骤**：`register("newuser", "secret123")`（真实 FP-002 散列默认路径）。
- **期望**：`{"status": "OK", "user": {"id", "username"}, "session_token"}`，`user.username == "newuser"`；`getUserByUsername("newuser")` 命中且字段完备 `{id, username, password_hash, salt, created_at}`，`created_at` 可解析；任何存储值中均不含明文 `secret123`；`verifyPassword("secret123", salt, hash)` 为 True（登录侧可校验）。

## TC-02 建号即进入登录态（验收 1）

- **期望**：成功结果含非空 `session_token`；默认路径（真实存储）`store.getSession(token)` 命中新建用户（登录态凭据真实可用）；注入会话工厂路径记录以新 user_id 调用、token 原样透传；两次成功注册 token 互异。

## TC-03 用户名已占用（验收 2）

- **前置**：种子 `alice` 已存在。
- **步骤**：提交 `alice` / 任意密码（合法长度的 `secret123` 与短密码 `12345` 各一次，验证用户名判定优先）。
- **期望**：均 `{"status": "ERROR", "reason": "USERNAME_TAKEN"}`；users 集合不变（不建号）；会话工厂零调用（不建会话）。

## TC-04 密码过短（验收 3）

- **前置**：用户名未占用。
- **步骤**：提交 `newuser` / `"12345"`（5 位）。
- **期望**：`{"status": "ERROR", "reason": "PASSWORD_TOO_SHORT"}`；不建号、不建会话；失败路径不触达散列（短密码不消耗慢散列）。边界：恰 6 位（`"123456"`）合法建号。

## TC-05 重复提交幂等（验收 4）

- **步骤**：同一注册（`newuser` / `secret123`）连续提交两次。
- **期望**：第一次 OK；第二次 `USERNAME_TAKEN`；users 中 `newuser` 恰一条记录；会话仅建立一次（第二次不新建）。

## TC-06 并发提交唯一性（验收 4）

- **步骤**：多线程并发提交同一注册（内存替身路径同服务共享；真实 SQLite 路径每线程独立 `DataStore` 连接同库文件，模拟并发请求）。
- **期望**：恰一个 OK，其余全部 `USERNAME_TAKEN`；结束后 users 中该用户名仅一条记录（唯一约束兜底，无重复账号）。

## TC-07 结果形状与失败原因语义（§3.2）

- **期望**：成功键集恰 `{status, user, session_token}`、`user` 键集恰 `{id, username}`；失败键集恰 `{status, reason}`，reason 仅取 `USERNAME_TAKEN` / `PASSWORD_TOO_SHORT` 两值；两分支互不掺杂（成功无 reason、失败无 user / session_token）。

## TC-08 真实散列集成（FP-002 契约，§8）

- **期望**：默认散列路径下两次注册同密码得到互异的 salt 与 hash（独立随机盐）；`verifyPassword(正确密码) True`、`verifyPassword(错误密码) False`。

## TC-09 非字符串入参（防御）

- `username` / `password` 为 `None` / 非 str → 抛 `TypeError`（编程错误 fail-fast，不占用业务 reason）。

## 运行

```bash
python3 -m pytest -q        # 全部 Python 测试（含 FP-001 / FP-002 / FP-011 / FP-013）
npm test                    # Node 端回归
```
