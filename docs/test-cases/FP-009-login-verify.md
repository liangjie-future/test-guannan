# 测试场景 FP-009：登录校验

对应验收标准（任务卡 §7）与独立验证方式（§8）。测试文件：`tests/test_login.py`，
运行 `pytest`。

前置：真实 FP-001 `DataStore`（临时 SQLite 文件，已合入无 Mock）+ FP-002
`hashPassword` / `verifyPassword`；种子用户 bob / 明文 `right-password`（散列+盐
入库，明文不入库）；错误样例 `"bob"/"wrong-password"`、`"ghost"/任意`。

## TC-01 正确凭证成功（验收 1）

- **步骤**：`login("bob", "right-password")`。
- **期望**：`{status: "OK", user: {id, username}, session_token}`；user 恰含
  `id` / `username` 两键（与库中 bob 记录一致）；`session_token` 为非空字符串。

## TC-02 成功建立真实会话（进入登录态）

- **步骤**：成功登录后以返回 token 查 `store.getSession(token)`。
- **期望**：会话存在且 `user_id` 为 bob 的 id（登录态凭据可解析回用户）。

## TC-03 成功响应形状精确、不含散列材料

- **步骤**：检查成功响应键集合与内容检索。
- **期望**：顶层恰 `{status, user, session_token}` 三键；repr 中不出现
  `password_hash` / `salt` / 明文 `right-password`。

## TC-04 重复登录 token 互异

- **步骤**：同一用户连续 3 次成功登录。
- **期望**：3 个 session_token 两两互异（每次登录各建新会话）。

## TC-05 错误密码 / 不存在用户名 → 统一失败（验收 2）

- **步骤**：`("bob", "wrong-password")`、`("ghost", 任意明文)`（含恰好用
  `right-password` 的情形）分别登录。
- **期望**：一律 `{status: "ERROR", message: "用户名或密码错误"}`（恰两键），
  无 session_token。

## TC-06 两失败场景响应不可区分

- **步骤**：对错误密码与不存在用户名的响应做 dict 与 repr 双重比对。
- **期望**：完全相等（文案、键集、形态一致，无法据响应区分哪项错）。

## TC-07 失败不建会话（会话集合不增长）

- **步骤**：失败登录前后直接数 sessions 表行数；注入计数版
  `create_session_on_login` 跑两失败场景。
- **期望**：行数保持 0 不增长；工厂零调用（无 token 产生）。

## TC-08 成功恰调一次 createSessionOnLogin(user_id)

- **步骤**：注入计数版工厂（返回真实 `{token, expires_at}` dict）成功登录。
- **期望**：恰一次调用、入参为 bob 的 id；返回值中的 token 被归一提取进
  `session_token`（dict / 裸字符串两种注入形态均正确取 token）。

## TC-09 防枚举时序口径：任一尝试恰一次 verifyPassword

- **步骤**：三个场景（正确、错误密码、用户名不存在）注入计数版
  `verify_password`（委托真实 FP-002）。
- **期望**：各恰一次调用且入参明文均为所提交密码——用户名不存在时也对诱饵
  凭证执行真实散列比对（不存在「查无此人提前返回」的时序差）。

## TC-10 非字符串输入 → 统一失败不抛异常

- **步骤**：username / password 取 `None` / `int` / `bytes` 组合。
- **期望**：一律统一失败响应；sessions 表不增长；无异常抛出。

## TC-11 存储侧凭证被篡改 → 统一失败不崩

- **步骤**：绕过接口将 bob 的 salt 改为非 hex 畸形值后登录。
- **期望**：统一失败、不建会话、不抛异常（FP-002 畸形数据返回 False 的兜底）。

## TC-12 全链路（FP-001 + FP-002 真实依赖）

- **步骤**：模拟注册（hashPassword → createUser）另一用户 carol 后交叉登录。
- **期望**：各自正确明文成功；用 bob 的明文登 carol 失败（独立盐，凭证不串号）。

## TC-13 §6 内存会话占位路径

- **步骤**：仅提供 `getUserByUsername` 的内存用户表（无会话原语）构造服务。
- **期望**：成功登录仍得到种子风格 token（占位承接「成功建会话」事件形状）；
  失败场景占位 token 集合不增长。

## 既有回归

- `pytest` 全量（FP-001 / FP-002 / FP-011 / FP-013 既有用例）与 `npm test`
  全量（FP-004 / FP-005 / FP-003）不回归。

## 运行

```bash
pytest -q          # 本任务 + Python 侧全量
npm test           # Node 侧回归
```
