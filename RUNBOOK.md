# RUNBOOK：单机部署与运行（FP-005）

> 部署形态：单机（本地 / 单台云机 / 容器）、单租户、单环境。无云编排平台依赖。

## 1. 构建产物形态

- 形态：**脚本直接运行的源码包**（无需编译、无需安装依赖）。
- 运行时要求：Node.js >= 18（零第三方依赖，无需 `npm install`）。
- 入口：
  - 部署/运维入口：`./run`（生命周期管理，见下文）；
  - 等价直启：`npm start`（`node src/index.js`）或 `node src/server.js`（前台，两者共用同一启动路径）。
- 部署方式：将仓库（或压缩包）复制到目标单机即可，无镜像 / 编排要求。

## 2. 运行配置

仅三项（单环境单租户，无多环境 / 多租户开关）：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `HOST` | `127.0.0.1` | 监听地址；云机/容器对外提供访问改为 `0.0.0.0` |
| `PORT` | `3000` | 监听端口（1–65535；`0` 仅测试临时端口，限前台模式） |
| `DATA_DIR` | `./data` | 数据目录（仓库根下，FP-001 持久化使用；启动自动创建） |

配置来源优先级：**环境变量 > `.env` 文件 > 默认值**。

```bash
cp .env.example .env   # 按需修改三项
./run config           # 打印生效配置（应恰为 HOST / PORT / DATA_DIR 三行）
```

`.env` 仅识别白名单内的上述三项，其他键一律忽略。

## 3. 启动 / 停止 / 重启 / 状态

```bash
./run start              # 守护模式：后台拉起 + 探活（GET / 200 才算成功），写 .run.pid
./run start --foreground # 前台模式：容器 / 调试场景，Ctrl-C 或信号优雅退出
./run status             # 状态（退出码 0=运行中，3=未运行）
./run stop               # 停止（幂等；15s 未退出升级 SIGKILL）
./run restart            # 重启 = stop + start
```

日志：守护模式输出到 `./.run.log`（可用 `RUN_LOG_FILE` 改路径）。
脚本内部变量（非应用配置）：`RUN_ENV_FILE` / `RUN_PID_FILE` / `RUN_LOG_FILE` / `RUN_WAIT_TIMEOUT`。

## 4. 可达性验证

```bash
curl -i http://127.0.0.1:3000/
# 预期: HTTP/1.1 200 OK，content-type: text/html，
#        正文为 FP-004 页面骨架（含 "页面骨架演示页" 与统一布局导航/页脚）
```

首页及各导航页由 FP-004 统一布局渲染，验证 200 即代表服务可达；
启动日志同样输出 `[server] service up: <url>` 供进程侧确认。

## 5. 重启后数据仍在的验证口径（呼应 FP-001）

1. 启动服务，向 `DATA_DIR` 写入标记文件：`echo marker > data/check.txt`；
2. `./run restart`（或 stop + start）；
3. 验证：`curl -i http://127.0.0.1:3000/` 仍 200 **且** `cat data/check.txt` 输出 `marker`（`DATA_DIR` 内容跨重启保留）；
4. 说明：业务数据（用户/帖子等）由 FP-001 落库，本口径验证其承载目录与服务的重启存活。

## 6. 故障排查

| 现象 | 处理 |
|------|------|
| `start` 报服务未就绪，日志含 `EADDRINUSE` | 端口被占用：改 `PORT` 或释放占用进程 |
| `错误: 未找到 node` | 安装 Node.js >= 18 并加入 PATH |
| `run status` 显示未运行但端口仍占用 | 非 `run` 管理的进程（如手动 `npm start`）：`lsof -i :3000` 定位后处理 |
| 行为异常 | 检查 `.env` 是否只含三项（`./run config`），删除未知键 |
