# FP-004 真实入口端到端验收设计

## 目标

通过真实 HTTP 请求验收最终生产装配，不注入业务 Mock。测试分别启动 `npm start` 和
`./run start --foreground`，在独立临时 `DATA_DIR` 中完成三用户注册、关注、发帖、时间线、
退出和重启流程，并覆盖 Python 桥接故障与资源清理。

## 关键决策

- 测试入口使用 `node:test`、Node 原生 `fetch` 与 `child_process.spawn`，不增加浏览器或运行时依赖。
- 每个场景创建独立临时目录，数据库路径固定为 `<DATA_DIR>/social.db`；测试数据只通过 HTTP
  注册和发帖产生，不调用 `bootstrap` 或 seed。
- 使用显式 Cookie jar 保存 `Set-Cookie` 中的 `session_token`，请求统一 `redirect: 'manual'`，
  以直接断言状态码和 `Location` 验证登录门槛及退出失效。
- 受控子进程通过 `PYTHON_BIN` 注入故障 worker：不可用可执行文件验证启动失败；非零、超时、非法
  JSON 和不可写/损坏数据库目录验证 503 或明确启动失败。worker 不返回业务成功，避免 Mock fallback。
- 每个 managed process 都先轮询首页健康状态，再执行请求；`finally` 中发送 SIGTERM、等待退出、
  确认端口拒绝连接，并清理临时目录。测试不使用守护模式，避免 PID/log 文件跨场景污染。
- 普通业务场景按入口参数化，重启场景停止并再次启动同一入口与 `DATA_DIR`，验证数据库中的账号、
  关注、帖子和未退出 session 仍然有效，同时验证退出 token 在退出前后和重启后均被拒绝。

## 验收边界

覆盖首页默认入口、A/B/C 注册登录、用户列表、重复关注、自关注、A/B/C 发帖、空白/280/281
Unicode code point、关注过滤和倒序时间线；故障场景检查响应不泄露密码、token 或完整堆栈。
