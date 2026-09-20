# 测试场景 FP-014：时间线页面

对应验收标准（任务卡 §7）与独立验证方式（§8）。测试文件：`tests/timeline.test.js`
（单元：渲染 + Mock）、`tests/timeline-page.test.js`（HTTP 层装配）。运行：`npm test`。

替身与种子（§6）：`getTimeline` 用可注入 Mock——场景 A 返回种子帖子流（B、C 各 2 帖，
发布时间交错、已按时间倒序 t4→t3→t2→t1，t4/t1 为 B，t3/t2 为 C）；场景 B 返回 `[]`；
登录态替身 alice（`{id:1, username:'alice'}`）。

## 单元：帖子流渲染（tests/timeline.test.js）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| T1 | Mock 场景 A 渲染 | 条目数 = 4（`data-testid="timeline-item"`）；每条含作者（bob/carol）、内容文本、时间；`<time datetime>` 为原始 ISO；内容区含标题「时间线」 |
| T2 | 范围与倒序（验收 1） | 作者集合恰为 {bob, carol}（无 alice / 他人）；页面顺序与服务返回顺序逐条一致（created_at 序列 t4→t3→t2→t1） |
| T3 | 顺序保持（页面不重排） | 替身故意按时间升序返回 → 页面仍按返回顺序渲染（页面不改变服务返回顺序，排序责任在 FP-015） |
| T4 | 空态（验收 2） | 场景 B（`[]`）→ 显示「还没有关注任何人」+ 引导链接 `/users`；不渲染任何 timeline-item |
| T5 | XSS 边界 | 帖子内容 / 作者名含 `<script>` 与属性注入载荷 → 全部经转义，无原始注入 |
| T6 | 作者缺失防御 | `author_username` 为 null 的条目回退渲染 `用户#<author_id>`，不崩溃 |
| T7 | Mock 契约 | 场景 A 返回 4 条（B×2+C×2、倒序）；场景 B 返回 `[]`；重复调用返回副本（调用方修改不污染种子） |

## HTTP 层：路由与登录门槛（tests/timeline-page.test.js）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| H1 | 基线模式（无 sessionAccess）已登录替身 + 场景 A | `GET /timeline` 200；统一布局（site-header/site-footer）；4 条目倒序、字段齐全 |
| H2 | 基线模式空态 | 场景 B → 200 且含「还没有关注任何人」与 `/users` 引导 |
| H3 | 基线模式匿名直访 | `GET /timeline` 200（FP-004 占位可达基线不回归），渲染登录引导而非空态 |
| H4 | requireLogin 门槛（sessionAccess 模式） | 匿名 `GET /timeline` 302 → `/login` |
| H5 | 会话模式已登录（alice） | 200 渲染帖子流；`getTimeline` 以 alice 的 id=1 被调用（查询主体正确） |
| H6 | 默认落点 | 已登录 `GET /` 302 → `/timeline`；未登录 `GET /` 200 演示页（FP-004 基线） |
| H7 | 生产组装（startServer 默认 Mock） | 携带有效会话种子凭据 `GET /timeline` 200 且含种子帖子流（场景 A） |

## 回归调整

- `tests/server.test.js` S2：`/timeline` 由 FP-014 实现替换占位，占位清单中移除
  （其余占位页断言不变）。

## 运行

```bash
npm test                 # Node 端全部测试
python3 -m pytest -q     # Python 服务层回归（不受本任务影响）
```
