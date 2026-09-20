# 测试场景 FP-002：密码加密存储

对应验收标准（任务卡 §7）与独立验证方式（§8）。测试文件：`tests/test_password.py`，运行 `pytest`。

## TC-01 hashPassword 契约与明文不出现在产物（验收 1）

- **步骤**：`hashPassword("password123")`；对返回值、库中存储做明文检索。
- **期望**：
  - 返回 dict 恰含 `{"hash", "salt"}` 两键（契约键名，不含明文）；
  - hash / salt 均为非空 hex 字符串（64 / 32 字符），其中不出现明文或明文片段；
  - 对同一明文多次调用，盐两两互异（独立随机盐生效）；
  - 非 `str` 明文（`None` / `int` / `bytes`）→ `TypeError`。

## TC-02 verifyPassword 比对语义（验收 2）

- **步骤**：`hashPassword` 后分别以正确 / 错误明文调用 `verifyPassword`。
- **期望**：
  - 正确明文 → `True`；
  - 错误明文（大小写不同、前缀截断、完全无关、空串）→ 一律 `False`；
  - Unicode 明文（中文 + emoji）、超长明文（1024 字符）round-trip 正常；
  - 非 `str` 明文 → `TypeError`；
  - `iterations` 参与计算：同一 `{明文, 盐}` 以相同自定义迭代数生成 / 校验通过，以默认迭代数校验失败。

## TC-03 同明文不同盐 → 不同散列（验收 3）

- **步骤**：两名用户使用相同明文 `password123` 各自 `hashPassword`。
- **期望**：两者 salt 不同、hash 不同；且各自 `verifyPassword` 均通过（重算可复现）。

## TC-04 篡改存储数据 → 校验失败（§8）

- **步骤**：对合法 `{salt, hash}` 篡改 salt 任一 hex 字符 / 篡改 hash 任一字符 / 交换两用户的 salt。
- **期望**：全部 `False`。

## TC-05 畸形存储数据 → False 不抛异常

- **步骤**：salt / hash 取非 hex 字符串、空串、非字符串（`None` / `int`）、长度不符（截断 / 超长）。
- **期望**：一律 `False`（登录侧只处理布尔）；不抛任何异常。

## TC-06 恒时比对与单向性口径（§8）

- **步骤**：检查实现使用 `hmac.compare_digest`（源码静态断言）；散列输出与明文无还原关系。
- **期望**：静态断言通过；`hash != 明文`、`hash` 非 hex 之外的编码；同一 `{明文, 盐}` 重算散列确定一致（可复现）。

## TC-07 与 FP-001 存储集成：注册写入 → 读回校验（验收 1 全链路）

- **前置**：真实 `DataStore`（临时 SQLite 文件），FP-001 已合入（无 Mock）。
- **步骤**：模拟注册——`hashPassword("password123")` → `createUser(username, hash, salt)` → `getUserByUsername` 读回 → `verifyPassword`。
- **期望**：
  - 读回的 `password_hash` / `salt` 与写入一致（其余字段不受影响）；
  - `verifyPassword("password123", …)` → `True`，错误明文 → `False`；
  - 用户名冲突语义不受影响（`UsernameAlreadyExistsError`）。

## TC-08 明文不落盘（§4 检查口径）

- **步骤**：注册后关闭连接，读取 SQLite 文件原始字节，检索明文 `password123` / `hunter2`。
- **期望**：文件字节与全部接口返回值中均检索不到明文（WAL / journal 文件一并检查）。

## TC-09 种子数据（§6）

- **步骤**：`load_seed(store)` / CLI `python -m security.seed <db>`。
- **期望**：2 名种子用户（`seed-password-a` ↔ `password123`、`seed-password-b` ↔ `hunter2`）可读回且各自 `verifyPassword` 通过；两者 salt、hash 均不同（独立盐）；重复执行幂等（不报错、不重复建号）；CLI 退出码 0。

## 运行

```bash
pytest -q
```
