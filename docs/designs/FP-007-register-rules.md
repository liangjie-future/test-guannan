# 设计笔记 FP-007：注册规则与建号

## 目标

交付注册业务核心服务 `register(username, password)`：校验用户名唯一、密码 ≥6 位，通过后建号（users 表写入用户名 + 密码散列 + 盐 + 创建时间，全链路无明文）并进入登录态（建号即建立会话，返回登录态凭据）；失败返回结构化 reason（`USERNAME_TAKEN` / `PASSWORD_TOO_SHORT`），不建号、不建会话；重复 / 并发提交由用户名唯一约束兜底，仅产生一个账号。

## 技术选型

- **语言**：Python 3（任务卡语言无关；强依赖 FP-001 `storage.DataStore` 与 FP-002 `security.hashPassword` 均已用 Python 落地，本任务是两者 §3.2 契约的直接消费方，同语言零胶水成本，且仓库 pytest 基建已就绪）。
- **形态**：纯服务层（无 HTTP、无 UI）——§5 明确注册页输入收集与展示归 FP-006，本任务以服务契约供其调用。

## 关键决策

1. **RegistrationService 组合三个注入依赖，只认契约形状（鸭子类型）**：
   - `store`：FP-001 §3.2 最小契约 `createUser(username, password_hash, salt) → user_id ｜ 冲突抛「用户名已存在」` + `getUserByUsername(username) → user ｜ null`；
   - `hash_password`：FP-002 §3.2 契约 `hashPassword(plain) → {hash, salt}`，默认取真实实现（生产路径）；测试可注入快速替身（§6 Mock 策略）；
   - `create_session_on_login`：FP-003 契约 `createSessionOnLogin(user_id) → 会话凭据 token`。FP-003 的访问控制层落地在 Node（`src/session-access.js`），Python 服务无法进程内直连，故以可注入 callable 承接：默认实现 `store.createSession(user_id)["token"]`（FP-001 提供的会话持久化原语，即 FP-003 组合的存取底座）；Web 层（FP-006/FP-009）联调时可注入自有会话工厂。
2. **校验顺序（§4 列举序）**：用户名占用（`getUserByUsername` 命中 → `USERNAME_TAKEN`）→ 密码长度（`len(password) < 6` → `PASSWORD_TOO_SHORT`）→ 散列 → 建号 → 建会话。已占用用户名配任意密码（含短密码）一律 `USERNAME_TAKEN`，与验收 2「提交 alice/任意密码」一致；失败路径不触达 `hashPassword`（短密码不消耗慢散列）也不触达写入与会话。
3. **返回形状严格对齐 §3.2**：成功 `{"status": "OK", "user": {"id", "username"}, "session_token": <token>}`；失败 `{"status": "ERROR", "reason": USERNAME_TAKEN ｜ PASSWORD_TOO_SHORT}`，reason 以模块常量导出（`REASON_*`）。不抛业务异常——契约即返回值形态，调用方按 reason 展示提示。
4. **并发 / 重复提交幂等口径**：预检 `getUserByUsername` 之后再 `createUser`，窗口内的并发竞争由存储侧用户名唯一约束兜底——`createUser` 冲突异常捕获后映射为 `USERNAME_TAKEN` 返回（不建号、不建会话、不向上抛）。需捕获的冲突类型即 FP-001 契约错误 `storage.UsernameAlreadyExistsError`（契约含错误形态，import 契约异常不算耦合存储实现）；同一注册无论连续或并发重复提交，users 中该用户名仅一条记录。
5. **密码口径**：最小长度 6 **含边界**（恰 6 位合法、5 位拒绝），按码点计（`len()`）；密码不做去空白等规范化（契约只定义长度规则，静默改写密码会改变登录口径）。
6. **全链路无明文**：服务收到明文后仅在内存中交给 `hash_password`，落库字段仅 `username / password_hash / salt / created_at`；返回值亦不含密码。username 仅做占用查询原样落库，不加规则（§4 未定义用户名格式规则，不发明）。
7. **非字符串入参**：契约错误语义只覆盖两类业务失败；`username` / `password` 非 str 属调用方编程错误，显式抛 `TypeError`（fail-fast，与 FP-002 / FP-013 口径一致）。

## 目录结构

```
services/
  __init__.py         # 追加导出 RegistrationService 与 REASON_* / MIN_PASSWORD_LENGTH
  registration.py     # register 服务实现（校验 → 散列 → 建号 → 建会话）
tests/
  test_registration.py
docs/
  designs/FP-007-register-rules.md
  test-cases/FP-007-register-rules.md
```

## Mock 与种子策略（§6）

FP-001 / FP-002 / FP-003 均已合入：生产路径默认取真实 `hashPassword` 与 `store.createSession` 派生的会话工厂。测试保留 §6 模拟路径以证明服务只依赖契约形状：

- **内存契约替身**（users Map + 用户名唯一约束以锁保证原子、createSession 返回种子 token `seed-token-N`）跑同一套规则断言；
- **快速散列替身**（sha256 确定性摘要，不含明文）用于多数用例，避免 600k 迭代慢散列拖慢套件；真实 FP-002 路径专测（落库无明文 + `verifyPassword` 往返 + 盐独立）。

种子数据（§6）：已占用用户名 `alice`（散列占位记录）；合法输入 `newuser` / `secret123`；过短输入 `12345`。

## 集成点修复（差异走集成点）

并发验证（TC-06 真实 SQLite 多连接路径）暴露 FP-001 `DataStore.createUser` 缺陷：用户名冲突时 `sqlite3.IntegrityError` 分支直接抛 `UsernameAlreadyExistsError` 而未回滚，失败连接的未决事务继续持有 SQLite 写锁，其余并发提交方等待 5s busy 超时后报 `database is locked`（而非语义正确的 `USERNAME_TAKEN`）。修复：`except` 分支先 `rollback()` 再抛（storage/store.py，附带回归即 TC-06 本身）。

## 非范围提醒（§5）

注册页输入收集与结果展示（FP-006）、密码散列算法本体（FP-002）、users 表持久化与唯一约束（FP-001）、会话生命周期管理（FP-003）均不在本任务实现；登录校验（FP-009）为后续消费方。
