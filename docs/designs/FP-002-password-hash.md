# 设计笔记 FP-002：密码加密存储

## 目标

交付 `hashPassword` / `verifyPassword` 两个纯能力接口：注册建号写入侧生成「单向慢散列 + 独立随机盐」，登录校验比对侧重算比对；全链路（存储 / 日志 / 响应）不出现明文密码。

## 技术选型

- **算法**：PBKDF2-HMAC-SHA256（Python 标准库 `hashlib.pbkdf2_hmac`，OpenSSL 后端）。任务卡 §3.2 允许 PBKDF2 / scrypt / bcrypt / argon2 任一标准单向慢散列；选 PBKDF2 是因为零第三方依赖即可达到「标准慢散列 + 可调成本」要求（与 FP-001 的零依赖原则一致）。
- **参数**：迭代 600,000 次（OWASP 对 PBKDF2-HMAC-SHA256 的现行建议值，实测单次 ≈0.11s，注册 / 登录可接受且暴力破解成本足够高）；盐 `secrets.token_bytes(16)`（CSPRNG，128 bit，hex 32 字符）；散列输出 32 字节（hex 64 字符）。
- **语言与位置**：Python 3（与强依赖 FP-001 的存储层同栈，契约函数名沿用仓库既定的 camelCase 风格）。新包 `security/`，与 `storage/` 平级——密码安全是纯能力，不属于存储层职责（§5：表持久化归 FP-001）。

## 关键决策

1. **接口签名即共享契约**（§3.2，供 FP-007 注册 / FP-009 登录消费）：
   - `hashPassword(plain_password) → {"hash": <hex>, "salt": <hex>}`：每次调用生成独立随机盐，返回值仅含散列与盐（不含明文，键名与契约一致）。
   - `verifyPassword(plain_password, salt, stored_hash) → bool`：以存储盐重算散列，与存储散列做恒时比对（`hmac.compare_digest`，防时序侧信道）。
   - `iterations` 为关键字参数暴露（默认 600,000），仅为测试 / 未来参数升级留缝，调用方（FP-007/009）无需传。
2. **存储格式**：`hash` / `salt` 均为 hex 字符串，与 FP-001 `users.password_hash TEXT / salt TEXT` 两列一一对应（`createUser(username, hash, salt)` 直接透传）。参数不编码进散列串：迭代数是模块级常量，升级参数时按「登录成功即重散列」策略由 FP-009 处理（本层不感知）。
3. **明文不落盘 / 不进日志的检查口径**（§4）：
   - 模块零日志——不 import logging、不 print，明文与散列均不出现在任何日志通道；
   - `hashPassword` 返回值、`verifyPassword` 入参出参均不含明文字段；
   - 写库路径上明文只存在于内存中的函数实参，`createUser` 收到的仅是 `{hash, salt}`；
   - 测试以「SQLite 文件原始字节 + 全部返回值 repr 中检索不到明文」为验收口径（TC-09）。
4. **校验的健壮性语义**：存储侧数据（salt / stored_hash）非 hex、空串、非字符串 → 一律 `False`（比对失败），不抛异常——登录流程（FP-009）只需处理布尔；`plain_password` 非 `str` → `TypeError`（程序员错误显式暴露）；盐 / 散列长度与生成口径不符 → `False`（含防「空盐 + 空散列」碰撞边界）。
5. **Mock 策略**（§6）：FP-001 已合入，直接用真实 `DataStore`（临时 SQLite 文件）验证写入 / 读回 / 比对全链路；不引入内存 Map。
6. **种子数据**（§6）：`security/seed.py` 提供 `load_seed(store)` + CLI（`python -m security.seed <db路径>`），写入 2 名种子用户：`seed-password-a`（明文 `password123`）、`seed-password-b`（明文 `hunter2`），各自独立盐与散列；幂等（已存在跳过）。
7. **单向性**：PBKDF2 是单向慢散列，无密钥不可逆；验证口径为「标准算法 + 输出与输入无代数还原关系」，测试断言散列 ≠ 明文、不同明文散列不同、同明文不同盐散列不同。

## 目录结构

```
security/
  __init__.py    # 导出 hashPassword / verifyPassword / 常量
  password.py    # 散列 + 盐生成 / 恒时比对实现
  seed.py        # 验证用种子用户（2 名，独立盐与散列）+ CLI
tests/
  test_password.py
docs/
  designs/FP-002-password-hash.md
  test-cases/FP-002-password-hash.md
```

## 非范围提醒

注册规则与建号流程（FP-007）、登录校验流程与统一错误提示（FP-009）、users 表持久化（FP-001，已合入直接消费）均不在本任务实现；本任务只交付纯散列 / 校验能力与验证用种子。
