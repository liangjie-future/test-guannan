# 测试场景 FP-007：点赞与取消点赞动作

对应任务卡 §7 五条验收标准与边界路径。测试文件：`tests/like-action.test.js`，
运行 `node --test tests/like-action.test.js`。HTTP 级断言（302 / Location /
405）+ `getLikesByPostIds` 存储态断言，风格对齐 `tests/access-control.test.js`。

种子约定（§6）：用户 alice=1 / bob=2（`webUsers()` 会话用户表）；
帖 P1（bob）；会话 Cookie `session_token=seed-token-1`（alice）；likeStore
注入 `createMemoryInteractionStore`（显式 `likes` 种子控制净空 / 已赞 /
他赞前置态）。

## TC-01 登录点赞（验收 1 主场景）

- **步骤**：净空 likeStore，alice 携有效 Cookie `POST /posts/1/like`。
- **期望**：302、`Location: /timeline`（PRG）；`getLikesByPostIds([1])`
  恰一条 `{post_id: 1, user_id: 1}` 且 `created_at` 为非空字符串。
  alice 关注 bob 与否不影响（登录即可写，组装不注入关注关系）。

## TC-02 已赞再点 → 取消（验收 2）

- **步骤**：likeStore 种子含 alice→P1；alice `POST /posts/1/like`。
- **期望**：302、`Location: /timeline`；`getLikesByPostIds([1])` 无该条
  （记录删除）。可见计数减一的呈现属 FP-004 / FP-006 联调，不在本任务断言。

## TC-03 未登录门槛（验收 3）

- **步骤**：无 Cookie、无效 token（`session_token=nope`）、过期 token
  （`seed-token-expired`）三种凭据各 `POST /posts/1/like`。
- **期望**：一律 302、`Location: /login`；`getLikesByPostIds([1])` 为空
  （不产生点赞记录）。

## TC-04 幂等两端一致（验收 4）

- **4a 存储级**：直调 `likePost(1, alice)` 连续两次 → 恰一条记录
  （FP-005 Mock 幂等；FP-001 唯一约束同口径）。
- **4b 路由级 toggle 回落**：种子含 carol(3)→P1；alice 连续两次
  `POST /posts/1/like`。期望：第一次后 alice 与 carol 各一条；第二次后
  alice 无残留、carol 记录原样保留（取消不误删他人记录）。

## TC-05 帖主自赞不设防（验收 5）

- **5a 存储级（绕过界面）**：直调 `likePost(1, bob)`（帖主对自己帖子）→
  记录写入成功，不抛错、不拒绝。
- **5b 路由级**：bob 经 `createSessionOnLogin(2)` 建会话后
  `POST /posts/1/like` → 302 /timeline 且产生 `(P1, bob)` 记录
  （时间线可见者即可写，动作层不校验帖主身份）。

## TC-06 方法门槛 405

- **步骤**：alice 已登录，`GET / DELETE /posts/1/like`。
- **期望**：405、`Allow: POST`；不产生点赞记录。

## TC-07 匿名 + 非 POST：守卫顺序（边界）

- **步骤**：无 Cookie `GET /posts/1/like`。
- **期望**：302 /login（登录守卫先行于方法判定，对齐关注动作
  `handleFollowAction` 顺序）；不产生记录。

## TC-08 路径解析（边界）

- **单元**：`parseLikeActionPath('/posts/12/like')` → 12；
  `/posts/abc/like`、`/posts/1/like/extra`、`/posts/1/likes`、
  `/posts/1/unlike`、`/users/3/follow`、`/posts//like` → null。
- **HTTP**：已登录 `GET /posts/abc/like` → 不命中动作路由，走既有 404 基线。

## TC-09 组装基线（边界）

- **未注入 likeStore**（仅 sessionAccess）：`POST /posts/1/like` → 404
  （路由不可达，对齐 `usersPage === null` 模式）。
- **未注入 sessionAccess**（仅 likeStore，FP-004 基线组装）：
  `POST /posts/1/like` → 302 /login（`defaultCurrentUser` 恒 null 走匿名
  分支）；不产生记录。

## 运行

```bash
node --test tests/like-action.test.js   # 本任务
npm test                                # Node 全量回归
python3 -m pytest -q                    # Python 侧回归（不受影响）
```
