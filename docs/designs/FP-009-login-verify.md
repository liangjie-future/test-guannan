# 设计笔记 FP-009：登录校验

## 目标

交付登录校验服务 `login(username, password)`：核对用户名与密码（与存储散列
比对），通过则建立会话进入登录态并返回登录态凭据；失败则返回统一提示
（「用户名或密码错误」，不区分哪项错——防账号枚举）且不建立会话。

## 技术选型与整体形态

- **Python 3 + `services/` 服务层**：与强依赖 FP-001（storage）、FP-002（security）
  同栈，沿用 `FollowService` / `PostService` 的既有模式——构造注入依赖，
  方法签名即任务卡 §3.2 共享契约，零第三方依赖。
- **链路**（§4）：`getUserByUsername` → `verifyPassword` → `createSessionOnLogin`。
  前两项直接绑定真实实现（FP-001 / FP-002 均已合入）；第三项注入式。

## 关键决策

1. **结果形态严格按 §3.2**：成功恰为
   `{status: "OK", user: {id, username}, session_token}`（无多余键，user 不含
   password_hash / salt——散列材料不进响应）；失败恰为
   `{status: "ERROR", message: "用户名或密码错误"}`。两失败路径的响应形状
   本身不可区分（共享常量 `LOGIN_ERROR_MESSAGE`，各自构造全新 dict，深相等）。
2. **统一失败语义且失败不建会话**：用户名不存在与密码错误走同一 `_error()`
   出口，`createSessionOnLogin` 只在校验通过后被调用（结构上保证失败零会话，
   而非仅靠约定）。
3. **防枚举时序均衡（诱饵校验）**：用户名不存在时若直接提前返回，「查无此人」
   （不做 PBKDF2，≈0ms）与「密码错误」（≈0.1s）的响应耗时可区分，构成账号
   枚举侧信道。故用户名不存在时对模块内诱饵 `{salt, hash}`（懒生成，进程一次）
   执行一次真实 `verifyPassword` 并丢弃结果——任一尝试的计算成本一致（结构化
   不变量：**每次 login 恰好调用 verifyPassword 一次**，测试以此断言）。
4. **跨语言会话适配（对等沿用 FP-003 决策 1 的做法）**：FP-003 的
   `createSessionOnLogin` 产在 Node，Python 进程无法进程内调用。Python 侧默认
   适配器绑定 FP-001 会话原语 `store.createSession(user_id)`——即 FP-003 Node
   实现所包装的同一 §3.2 契约；联调时替换注入即可，登录逻辑零改动。
5. **§6 会话占位回退**：store 不具备会话原语（FP-003 / FP-001 会话切片均未
   合入的口径）时，回退内存占位 `_MemorySessionPlaceholder`（返回种子风格
   token），仅承接「成功建会话」事件形状；会话生命周期（过期 / 销毁）仍归
   FP-003。
6. **token 归一**：`createSessionOnLogin` 返回 `token` 字符串（任务卡表述）或
   `{token, expires_at}`（FP-003 实际形态）均取 `token`，两种注入形态等价。
7. **输入健壮性**：`username` / `password` 非字符串 → 统一失败、不建会话、不
   抛异常（表单侧类型异常不应 500，且无法匹配任何凭证）；存储侧 salt / hash
   畸形由 FP-002 `verifyPassword` 返回 `False` 兜底 → 统一失败不崩。
8. **种子数据**（§6）：验证用种子用户 bob / 明文 `right-password`，经
   `hashPassword` 散列后入库（明文不入库），测试内自建（FP-001 已合入，无需
   内存用户表 Mock）；错误样例 `"bob"/"wrong-password"`、`"ghost"/任意`。

## 目录结构

```
services/
  __init__.py    # 追加导出 LoginService / LOGIN_ERROR_MESSAGE
  login.py       # login 服务：统一失败语义 + 会话建立 + 时序均衡
tests/
  test_login.py  # TC-01 ~ TC-13（见 docs/test-cases/FP-009-login-verify.md）
docs/
  designs/FP-009-login-verify.md
  test-cases/FP-009-login-verify.md
```

## 非范围提醒

登录页输入收集与错误展示、成功后跳转时间线（FP-008）；散列算法本体（FP-002，
已合入直接消费）；会话生命周期管理——过期 / 销毁 / 访问控制（FP-003，本任务
只在成功时建立会话）；注册与建号（FP-007）。
