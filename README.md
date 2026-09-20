# test-guannan

twitter 类社交平台（Step 1：注册登录 / 单向关注 / 280 字发帖 / 时间线）。

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

种子数据（alice / bob / carol，4 帖，2 条关注边，token=`seed-token-1`）：

```bash
python -m storage.seed social.db
```

测试：`pip install pytest && pytest`
