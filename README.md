# test-guannan

twitter 类社交平台（Step 1：注册登录 / 单向关注 / 280 字发帖 / 时间线）。
部署形态：单机、单租户、单环境（FP-005 提供运行载体）。

## FP-005 单机部署与运行

要求 Node.js >= 18（Web 端零第三方依赖，无需 `npm install`）。

```bash
cp .env.example .env   # 可选：按需调整 HOST / PORT / DATA_DIR
./run start            # 启动（守护模式）
curl -i http://127.0.0.1:3000/   # 验证：200 + FP-004 页面骨架
./run stop
```

运行配置仅 `HOST` / `PORT` / `DATA_DIR` 三项（环境变量 > `.env` > 默认值），
`DATA_DIR` 启动时自动创建。启动 / 停止 / 重启 / 状态 / 排障详见
[RUNBOOK.md](RUNBOOK.md)；`npm start` 与 `./run start --foreground` 等价直启。

## FP-001 核心数据模型与存储

嵌入式 SQLite 持久化层（Python 3 标准库，无第三方依赖），提供用户 / 帖子 / 关注关系 / 会话四类数据的读写契约：

```python
from storage import DataStore
from storage.seed import load_seed  # 种子数据（可选）

store = DataStore("social.db")   # 关闭后重新打开即等价应用重启，数据仍可读回
```

接口（任务卡 FP-001 §3.2 共享契约）：`createUser / getUserByUsername / getUserById /
listUsers / createPost / getPostsByAuthorIds / followExists / addFollow /
getFolloweeIds / createSession / getSession / destroySession`；错误类型
`UsernameAlreadyExistsError`（用户名已存在）、`SelfFollowError`（禁止自关注）。

建议将 SQLite 文件置于 `DATA_DIR`（默认 `<仓库根>/data`，如
`DataStore("data/social.db")`），与 FP-005 的数据目录约定保持一致。

种子数据（alice / bob / carol，4 帖，2 条关注边，token=`seed-token-1`）：

```bash
python -m storage.seed social.db
```

## FP-011 关注关系规则

关注服务层（消费 FP-001 存储，仅依赖 §3.2 契约形状，可换内存模拟）：

```python
from services import FollowService, FollowError, SelfFollowNotAllowedError, FolloweeNotFoundError
from storage import DataStore

svc = FollowService(DataStore("data/social.db"))
svc.follow(1, 2)        # 单向边 1→2：无需确认、不自动反向；重复关注幂等
svc.getFollowees(1)     # → [2, ...] 被关注者 id 集合（时间线聚合 / 页面已关注态数据来源）
```

错误语义：自关注抛 `SelfFollowNotAllowedError`（「不可关注自己」）；被关注者不存在抛
`FolloweeNotFoundError`（「用户不存在」）；两者均为 `FollowError` 子类。

## 开发与测试

```bash
npm test               # Node 端全部测试（node --test：test/ 与 tests/）
pytest                 # FP-001 存储层 Python 测试（pip install pytest）
```
