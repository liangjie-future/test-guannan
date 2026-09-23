# FP-004 真实入口端到端测试用例

测试文件：`tests/integration/real-entry.test.js`

## 正常业务

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| E2E-01 | `npm start` 启动临时目录 | 健康检查成功，首页 200，数据库为 `<DATA_DIR>/social.db` |
| E2E-02 | `./run start --foreground` 启动临时目录 | 与 E2E-01 行为一致，服务由受控子进程管理 |
| E2E-03 | A/B/C 通过 `/register` 注册 | 三次 302 `/timeline`，分别得到 HttpOnly、SameSite=Lax、7 天 Cookie |
| E2E-04 | A 访问 `/users` | 列出 A、B、C；A 自己没有可用关注表单 |
| E2E-05 | A 关注 B 两次 | 两次请求均 PRG 返回，第二次幂等，B 最终保持已关注 |
| E2E-06 | A 关注自己、B 关注 C | 自关注显示拒绝；B 的关注成功且不改变 A 的关注集合 |
| E2E-07 | A/B/C 发帖 | 三个作者均能真实发布，帖子进入 SQLite |
| E2E-08 | 空白、280、281 Unicode code point | 空白和 281 返回错误且不入库；恰好 280 成功 |
| E2E-09 | A 查看时间线 | 只显示 B 的帖子，不显示 A/C；同一作者多帖按 created_at 倒序 |
| E2E-10 | A 访问 `/` | 302 `/timeline`，默认入口与时间线一致 |

## 持久化和会话

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| E2E-11 | 停止并用同一 `DATA_DIR` 重启 | A/B/C、关注、帖子和未退出 session 均恢复 |
| E2E-12 | A 退出 | 旧 token 立即访问受限页面 302 `/login`，Cookie 被清除 |
| E2E-13 | 重启后携带退出 token | 仍然 302 `/login`，退出不会因重启复活 |

## 故障和安全

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| E2E-14 | `PYTHON_BIN` 不存在 | 启动失败且不监听端口，不伪造成功 |
| E2E-15 | worker 返回非零 | 启动失败或请求 503，响应不含完整堆栈、密码或 token |
| E2E-16 | worker 超时 5 秒 | 启动失败或请求 503，测试不会挂死 |
| E2E-17 | worker 输出非法 JSON | 启动失败或请求 503，响应明确失败 |
| E2E-18 | SQLite 路径为文件/不可用目录 | 启动失败或请求 503，不降级到内存 Mock |
| E2E-19 | 正常和异常退出 | 端口释放；受控 Node/Python 进程不残留 |

## 独立命令

每个命令均需立即保存退出码并保留完整日志：

```bash
set -o pipefail
npm test 2>&1 | tee /tmp/tg-a01-npm-test.log
npm_exit=${PIPESTATUS[0]}
python3 -m pytest -q 2>&1 | tee /tmp/tg-a01-pytest.log
pytest_exit=${PIPESTATUS[0]}
node --test tests/integration/real-entry.test.js 2>&1 | tee /tmp/tg-a01-real-entry.log
e2e_exit=${PIPESTATUS[0]}
```
