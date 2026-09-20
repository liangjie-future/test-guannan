# 测试场景 FP-013：发帖内容规则

对应验收标准（任务卡 §7）与独立验证方式（§8）。测试文件：`tests/test_posting.py`，运行 `python3 -m pytest -q`。

种子约定（§6）：作者 alice（新库首条用户，id=1）；内容样例——`"first post!"`（合法）、`""` / `"   "`（空）、280 字文本（边界合法）、281 字文本（超长）。每组场景分别在真实 `DataStore`（FP-001）与内存契约替身（仅 `getUserById` / `createPost` 两方法）上执行，验证服务只依赖 §3.2 契约。

## TC-01 合法内容发布成功（验收 1）

- **前置**：空存储，创建 alice（id=1）。
- **步骤**：`createPost(1, "first post!")`；再提交恰 280 字边界文本。
- **期望**：均返回 `{"status": "OK", "post": {...}}`；post 为 `{id, author_id, content, created_at}` 字段完备——`author_id == 1`、content 与规范化后入参一致、`created_at` 为可解析时间；两帖 id 互异；帖子可经 `getPostsByAuthorIds({1})` 读回（关联完整，具备进入时间线的数据）。

## TC-02 恰 280 边界与去空白口径（验收 1 / §4 长度口径）

- 281 字纯文本 → `TOO_LONG`；280 字（含 emoji / 汉字 / 换行混合，均按码点计）→ OK。
- `"  hello  "` → OK 且落库 content 为 `"hello"`（首尾空白去除）；内部空白 / 换行 / 制表符原样保留。
- 281 个空白字符 → `EMPTY_CONTENT`（非空校验先于长度，顺序语义）。

## TC-03 空内容拒绝（验收 2）

- **前置**：alice 存在。
- **步骤**：分别提交 `""` 与 `"   "`（全空白）。
- **期望**：均 `{"status": "ERROR", "reason": "EMPTY_CONTENT"}`；`getPostsByAuthorIds({1})` 保持为空，不产生帖子记录。

## TC-04 超长拒绝（验收 2）

- **前置**：alice 存在。
- **步骤**：提交 281 字文本。
- **期望**：`{"status": "ERROR", "reason": "TOO_LONG"}`；帖子集合不增长。

## TC-05 作者不存在拒绝（验收 3）

- **前置**：alice 存在。
- **步骤**：以不存在 id（如 999999）提交合法文本；再以同 id 提交空 / 超长文本（顺序验证）。
- **期望**：均 `{"status": "ERROR", "reason": "AUTHOR_NOT_FOUND"}`（作者存在性优先判定）；不产生帖子记录。

## TC-06 失败后帖子集合不增长（§8）

- **前置**：alice 已有 1 帖。
- **步骤**：依次触发三类失败（作者不存在 / 空 / 超长）。
- **期望**：每次失败后 `getPostsByAuthorIds({1})` 仍恰 1 帖；内存替身路径同时断言 `createPost` 落库调用次数为 0（失败短路在写入之前）。

## TC-07 仅依赖 §3.2 契约（Mock 策略验证）

- 用内存替身（Map users + 数组 posts，自增 id）替代 `DataStore` 跑通 TC-01/03/04/05 主路径：结果形状、reason、不写入语义与真实存储一致；成功帖对象由替身生成并原样透传。

## TC-08 非字符串入参（防御）

- `content=None` / 非 str → 抛 `TypeError`（编程错误 fail-fast，不占用业务 reason）。

## 运行

```bash
python3 -m pytest -q        # 全部 Python 测试（含 FP-001）
npm test                    # Node 端回归
```
