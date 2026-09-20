# 测试场景 FP-005：单机部署与运行

对应验收标准：

- A1：按运行说明在单机启动后，浏览器访问 `GET http://<HOST>:<PORT>/` 返回 200（FP-004 页面骨架），无多环境 / 多租户依赖；
- A2：运行配置仅含 `HOST` / `PORT` / `DATA_DIR` 等单机配置项，不存在多环境切换或多租户开关；
- A3（§8 建议测试）：停止后端口释放、再启动仍 200。

## 1. 配置（src/config.js）

| # | 场景 | 期望 |
|---|------|------|
| C1 | 空环境变量（无 .env） | 默认值：host=127.0.0.1、port=3000、dataDir=<仓库根>/data（绝对路径） |
| C2 | 环境变量设置 HOST/PORT/DATA_DIR | 三个值均被覆盖；相对 DATA_DIR 相对仓库根解析为绝对路径；绝对 DATA_DIR 原样保留 |
| C3 | PORT 边界 | `0`（临时端口，测试用）合法；`1`、`65535` 合法 |
| C4 | 非法 PORT（错误路径） | `abc`、`1.5`、`-1`、`70000`、`65536`、`3000.0`、`+3000`、`0x10` 等非纯数字形式一律抛错（含键名与原值）；` 3000 `（前后空白）与数字类型 `3000` 合法 |
| C5 | 空字符串环境变量 | 视同未设置，回落默认值 |
| C6 | 键集合恰为三项（A2） | 即使传入 `ENVIRONMENT`/`TENANT_ID`/`MULTI_TENANT` 等干扰变量，配置对象键恰为 `host/port/dataDir`；导出常量 CONFIG_KEYS = [HOST, PORT, DATA_DIR] |
| C7 | 不可变 | 返回对象被冻结，写入静默失败 |

## 2. HTTP 服务与首页（src/server.js，/ 由 FP-004 骨架页渲染）

| # | 场景 | 期望 |
|---|------|------|
| S1 | `GET /`（A1） | 200；`content-type: text/html; charset=utf-8`；正文为 FP-004 页面骨架（含 `页面骨架演示页` 与统一布局） |
| S2 | `HEAD /` | 200；无正文 |
| S3 | `GET /no-such-path` | 404 |
| S4 | `POST /`、`PUT /`（错误路径） | 405，响应头含 `allow: GET` |
| S5 | DATA_DIR 预留 | 启动时自动创建（含多级不存在路径） |
| S6 | 端口被占用（错误路径） | 第二个实例 listen 失败，startServer 以明确错误 reject（进程模式退出码非 0） |
| S7 | 停止→端口释放→再启动（A3） | 关闭第一个实例后连接被拒；以相同 host/port 再启动 `GET /` 仍 200 |

## 3. run 脚本（e2e，真实子进程）

| # | 场景 | 期望 |
|---|------|------|
| R1 | `run start --foreground` | 进程前台运行；`GET /` 200 含 `页面骨架演示页`（FP-004 骨架页）；日志输出监听地址 |
| R2 | SIGTERM 前台进程（A3 前半） | 优雅退出，退出码 0；随后该端口连接被拒（端口已释放） |
| R3 | 同端口再启动（A3 后半） | `run start --foreground` 再次拉起后 `GET /` 仍 200 |
| R4 | `run config`（A2） | stdout 恰好 3 行：HOST= / PORT= / DATA_DIR=，无其他键 |
| R5 | .env 加载与白名单 | .env 中 PORT 生效；`TENANT_ID`、`ENVIRONMENT` 等未知键被忽略（不出现在输出/行为）；环境变量优先于 .env |
| R6 | 守护模式生命周期 | `run start` 退出码 0 且完成探活 → `run status` 退出码 0（running）→ `GET /` 200 → `run stop` 退出码 0 → `run status` 退出码 3（not running）→ 端口连接被拒 |
| R7 | `run stop` 幂等（无进程/陈旧 PID 文件） | 退出码 0，不报错 |
| R8 | 守护模式 PORT=0（错误路径） | 拒绝启动并给出明确错误（探活无法定位临时端口） |

## 4. 测试实现说明

- 框架：Node 内置 `node:test` + `node:assert/strict`，HTTP 客户端用内置 `fetch`，零第三方依赖；
- 所有监听使用 `127.0.0.1`；临时端口由 `port 0` 或“先占后放”的空闲端口探测获得；
- e2e 用例通过 `child_process.spawn('bash', ['run', …])` 驱动真实脚本，PID / 日志 / env 文件均指向 `os.tmpdir()` 临时目录，不污染仓库；
- 每个用例注册 `t.after` 清理子进程与临时目录，防止泄漏。
