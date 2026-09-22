# 测试场景 FP-006：时间线内嵌受限互动区

对应任务卡 §7 验收 1–6 与 §8 独立验证方式。测试文件：`tests/timeline-interactions.test.js`
（断言走 HTML 字符串与 data-testid，风格对齐 tests/timeline-page.test.js）。运行：
`node --test tests/timeline-interactions.test.js`；全量 `npm test`。

替身与种子（§6）：

- `createMockGetVisibleInteractions()`（本卡 Mock，FP-005 内存 store 组装 §3.2-1 载荷）：
  种子与 FP-004/FP-005 同构——alice=1 / bob=2 / carol=3 / dave=4，互关边
  alice↔bob、alice↔carol、bob↔carol、bob↔dave；
  - P1（bob 帖）：点赞 carol（可见）/ dave（隐藏）/ bob（自互动排除），评论
    c1 carol、c2 dave（隐藏）、c3 bob（排除）、c4 alice（查看者恒可见），
    viewer_liked=false；
  - P2（carol 帖）：alice 已赞（viewer_liked=true）+ bob 评论（共同好友可见）；
  - P3 / P4：无互动（空态帖）。
- 自定义载荷替身：`(viewerId, posts) => posts.map(...)` 逐帖返回 §3.2-1 形状条目，
  供正序 / toggle / 结构一致 / XSS / 回显场景精确控制。
- `getTimeline` 替身返回最小帖子流（复用 createMockGetTimeline 场景 A 或显式数组）。

## 单元：互动区渲染（对应验收 1–6）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| A1 | 标准场景（验收 1）：alice 查含 P1 的时间线 | P1 互动区展示 carol 点赞（`visible-like-user`）与评论 c1/c4（正序 早→晚）；dave / bob 不出现在任何可见集合；计数位 `>1 赞<` `>2 评论<`（仅可见条目）；`getVisibleInteractions` 以 viewer id=1 与帖子数组被调用 |
| A2 | 顺序保持 | 载荷替身故意按正序返回多条评论 → 页面按载荷顺序原样渲染（渲染层不排序；正序由服务保证） |
| A3 | toggle 两态（验收 2） | 默认 Mock：P1 viewer_liked=false → `data-like-state="not-liked"`；P2 viewer_liked=true → `data-like-state="liked"`；两态按钮各在其帖互动区内 |
| A4 | 空态（验收 3） | P3 互动区 `>0 赞<` `>0 评论<`；无占位文案（无「暂无」）、无「部分已隐藏」/「隐藏」类提示（区域源码断言）；结构（计数位 / 表单 / 列表容器）仍在 |
| A5 | 非好友帖主同一呈现路径（验收 4） | 好友帖（bob）与非好友帖主帖（自定义作者）用同一载荷 → 两互动区归一化 post id 后逐字节同构（同一渲染函数、无分支差异） |
| A6 | 失败回显 TOO_LONG（验收 5，HTTP 层） | `GET /timeline?comment_failed_post=1&comment_error=TOO_LONG&comment_text=<281 字>` → P1 互动区含「评论失败：内容超过 280 字上限（当前 281 字），评论未发表」（`comment-feedback` + `data-reason="TOO_LONG"` 全页恰一处）；原文完整回显在 P1 输入框 |
| A6b | 失败回显 EMPTY_CONTENT（单元） | `render(alice, { searchParams })` → 「评论失败：内容为空（去首尾空白后无内容），评论未发表」；原文（纯空白）回显输入框 |
| A7 | 失败只影响目标帖 | 失败参数指向 P2 → 反馈与回显仅在 P2 互动区；P1 输入框为空、无反馈 |
| A8 | 全量正序不分页（验收 6） | 载荷 5 点赞 + 6 评论 → 全部渲染（计数 = 条数）、顺序与载荷一致、无分页控件 |

## Mock 契约与参数解析

| # | 场景 | 断言要点 |
| --- | --- | --- |
| M1 | 默认 Mock 载荷形状（§3.2-1） | 逐帖字段齐全（post_id / likes[user_id,username,created_at] / comments[id,user_id,username,content,created_at] / 两个可见计数 / viewer_liked）；P1 计数 1/2、viewer_liked=false；P2 viewer_liked=true；P3 空 0/0 |
| M2 | Mock 种子注入替换 | 显式空 likes/comments（或自定义种子）→ 载荷随种子（显式空数组即空态，不回落默认） |
| E1 | 回显参数解析边界 | 缺 comment_failed_post / comment_error、未知 error 码、非数字 post → 不渲染任何反馈；comment_text 缺省按空串回显 |
| E2 | 无参数基线 | 不带任何回显参数渲染 → 全页无 `comment-feedback` |

## 安全与交互细节

| # | 场景 | 断言要点 |
| --- | --- | --- |
| X1 | XSS 边界 | 评论内容 / 用户名含 `<script>`、`<img onerror>` 载荷与回显 comment_text 含属性注入 → 全部经转义，无原始注入 |
| C1 | 字数提示（对齐 compose.js） | 每互动区 `char-counter`：`data-max="280"`、初始 `0 / 280`；回显帖初始计数 = 原文码点数（如 281）；页面脚本恰一段且按互动区作用域绑定；输入框不设 maxlength（超限可达） |
| C2 | 动作端点占位（§3.2-4） | 点赞表单 `method="post" action="/posts/<id>/like"`；评论表单 `action="/posts/<id>/comment"`、textarea `name="content"` |

## 回归

- 既有 `tests/timeline.test.js` T1–T8、`tests/timeline-page.test.js` H1–H8、
  `tests/server.test.js` 零改动应保持通过：互动区不新增 `<time>` 元素（评论时间用
  `<span>`）、不改变 timeline-item 计数与顺序断言；`renderTimelinePosts(posts)`
  纯调用保持 FP-014 输出。

## 运行

```bash
node --test tests/timeline-interactions.test.js   # 本卡
npm test                                          # Node 端全量
python3 -m pytest -q                              # Python 服务层回归（不受影响）
```
