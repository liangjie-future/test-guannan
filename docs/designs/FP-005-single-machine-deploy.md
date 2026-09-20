# 设计笔记 FP-005：单机部署与运行

## 1. 背景与目标

为 twitter 类社交平台 Step 1 提供单机（本地 / 单台云机 / 容器）、单租户、单环境形态的部署运行载体：

- 启动入口（脚本 + 命令）与运行配置模板（仅 `HOST` / `PORT` / `DATA_DIR`）；
- 占位首页路由 `GET / → 200`（验证服务可达，后续由 FP-004 替换为正式骨架页）；
- RUNBOOK（启动 / 停止 / 重启、重启后数据可读回的验证口径）；
- 构建产物形态说明。

## 2. 关键决策

### D1 技术选型：Node.js（>= 18）标准库，零第三方依赖

任务卡声明技术栈语言无关（可执行包 / 镜像 / 脚本任一）。选择 Node.js 内置 `node:http` 直写：

- 仓库克隆后无需 `npm install`、无需编译即可拉起（脚本即构建产物）；
- 环境已具备 Node v22，`node:test` 内置测试框架，测试同样零依赖；
- 后续 FP-004 / FP-007 等功能可在同一入口上叠加。

### D2 运行配置契约：仅 HOST / PORT / DATA_DIR

- `src/config.js` 输出的配置对象**有且仅有** `host` / `port` / `dataDir` 三个字段（`Object.freeze`），结构上不存在多环境 / 多租户开关（呼应验收第 2 条）；
- 来源优先级：环境变量 > `.env` 文件 > 默认值（`127.0.0.1` / `3000` / `<仓库根>/data`）；
- `run` 脚本加载 `.env` 时按 `HOST|PORT|DATA_DIR` **白名单**解析，未知键（如 `ENVIRONMENT`、`TENANT_ID`）直接忽略，从入口侧兜底“无多环境 / 多租户开关”；
- `PORT` 必须是 0–65535 的整数（0 仅供测试的临时端口），非法值启动即报错退出；
- 相对 `DATA_DIR` 相对仓库根解析，避免 cwd 不同导致数据目录漂移；启动时 `mkdir -p` 创建，预留 FP-001 持久化使用（本任务不落库）。

### D3 启动入口与生命周期：`run` 脚本（bash）

子命令：`start [--foreground]` / `stop` / `restart` / `status` / `config`。

- 后台模式：`nohup node src/server.js` + PID 文件（默认 `<仓库根>/.run.pid`）+ 日志文件（`.run.log`），启动后主动探活 `GET /`（超时 15s，失败自动回收并退出非 0）；
- 前台模式（`--foreground`，`exec node`）：适配容器 / 调试场景，信号直接送达 Node 进程；
- `stop`：SIGTERM → 优雅退出（超时升级 SIGKILL）；幂等（无进程时退出 0，陈旧 PID 文件自动清理）；
- 进程存活判定兼容僵尸态：容器内 PID 1 可能不回收孤儿进程，`kill -0` 对僵尸仍成功，故结合 `/proc/<pid>/stat` 状态（`Z` 视为已消亡；无 `/proc` 的平台回落纯 `kill -0`）；
- `status`：运行中退出码 0，未运行退出码 3（LSB 惯例，便于脚本化）；
- `config`：打印生效配置（恰三项），供验收“检查配置仅含单机配置项”；
- 脚本内部路径（PID / 日志 / env 文件位置）可经 `RUN_PID_FILE` / `RUN_LOG_FILE` / `RUN_ENV_FILE` 覆盖——属运维内部变量，**不属于**应用运行配置。

### D4 首页（与 FP-004 集成后）

`GET /` 返回 200，`text/html; charset=utf-8`，正文为 **FP-004 统一布局页面骨架**（含 `页面骨架演示页` 与页头导航/页脚）；`HEAD /` 同样 200 且无正文。已注册路由的非 GET/HEAD 方法 → 405（带 `Allow: GET`），未知路径 → 404（FP-004 的 HTML 404 页），畸形请求行 → 400。可达性探活/验证以「`GET /` 200」为准，进程侧日志输出 `service up: <url>`。

> 集成说明：本任务最初交付占位首页（正文含 `service up`）；rebase 合入 FP-004
> 页面骨架（PR #1）后，`/` 由 FP-004 `createWebServer` 处理器渲染，占位首页移除，
> FP-005 的配置 / 启动 / 优雅停机管线叠加在其外层（`startServer` /
> `registerGracefulShutdown`）。

### D5 优雅停机

SIGTERM / SIGINT 触发：停止接受新连接 → 关闭空闲连接 → 1s 后强制关闭残留连接 → 2s 兜底退出，退出码 0。保证“停止后端口释放、再启动仍 200”的可验证性。

### D6 跨主机/容器适配

- `HOST=0.0.0.0`（云机 / 容器对外暴露）时，脚本探活自动改打 `127.0.0.1`；
- IPv6 字面量（如 `::1`）在 URL 中自动加方括号。

## 3. 文件结构

```
run                    # 启动/停止/重启入口（bash，白名单加载 .env）
.env.example           # 运行配置模板（仅 HOST/PORT/DATA_DIR）
src/config.js          # 配置加载与校验（HOST/PORT/DATA_DIR 唯一加载点）
src/index.js           # npm start 入口（委托 src/server.js 的 main）
src/server.js          # FP-004 页面路由 + FP-005 startServer/优雅停机
package.json           # npm start / npm test 入口
RUNBOOK.md             # 运行说明（启动/停止/重启/验证/排障）
test/                  # node:test 测试（config / server / run 脚本 e2e）
```

> 集成说明（模块体系）：main 侧 `package.json` 已声明 `"type": "module"`
> （FP-004 源码为 ESM），故本任务 `src/config.js` / `src/server.js` /
> `test/*.test.js` 以 ESM 交付；`npm start`（`node src/index.js`）与
> `./run start --foreground`（`node src/server.js`）共用同一启动路径与
> `loadConfig` 配置加载，环境变量读取无第二处（index.js 不再直读
> `process.env.PORT`）。FP-001 的 Python 存储与 `DATA_DIR` 约定并存：
> SQLite 文件建议置于 `DATA_DIR`（如 `data/social.db`）。

## 4. 测试策略

- 单元：配置默认值 / 覆盖 / 非法 PORT / 键集合恰为三项；
- 路由级（真实 listen，临时端口）：GET 200、HEAD 200、404、405、端口占用报错、DATA_DIR 创建；
- 生命周期：server 级 stop→端口释放→restart 仍 200；
- e2e（`run` 脚本，真实子进程）：前台模式启动→200→SIGTERM 退出 0→端口释放→再启动仍 200；`config` 输出恰三项 + env 优先级 + 未知键忽略；守护模式 start/status/stop 退出码与探活。
