# 设计笔记 FP-013：发帖内容规则

## 目标

交付发帖业务核心服务 `createPost(author_id, content)`：校验帖子为 1–280 字非空纯文本（去首尾空白后计字符数），通过后落库并关联作者与创建时间，使记录具备进入关注者时间线的完整数据（author_id / content / created_at）。

## 技术选型

- **语言**：Python 3（强依赖 FP-001 已合入，产出为 Python 包 `storage`，`DataStore` 提供 §3.2 契约 `createPost` / `getUserById`；服务层与其同进程消费最自然，且仓库测试基建 pytest 已就绪）。
- **依赖**：仅 FP-001 `DataStore`（SQLite）。无外部系统（§3.3 无）。

## 关键决策

1. **服务层独立于存储层**：新增 `services` 包，`PostService(store)` 持有任何满足 §3.2 最小契约（`getUserById`、`createPost` 两方法）的对象。FP-001 已合入，生产路径直接传 `DataStore`；任务卡 §6 的内存 Mock 不进入产品代码（已被真实实现取代），但测试中保留一个内存替身，证明服务仅依赖契约而非 SQLite 细节。
2. **返回形状严格对齐 §3.2 契约**：成功 `{"status": "OK", "post": {id, author_id, content, created_at}}`；失败 `{"status": "ERROR", "reason": ...}`，reason 取 `AUTHOR_NOT_FOUND` / `EMPTY_CONTENT` / `TOO_LONG` 三值，以模块常量导出（`REASON_*`）。不抛业务异常——契约就是返回值形态，调用方（FP-012 界面）按 reason 展示提示。
3. **校验顺序**（任务卡 §3.2 建议）：作者存在 → 内容非空（去首尾空白后）→ 长度 ≤ 280。顺序即优先级：不存在作者提交任意内容（含空 / 超长）均报 `AUTHOR_NOT_FOUND`；全空白超长文本报 `EMPTY_CONTENT` 而非 `TOO_LONG`。
4. **长度口径（D3）**：`content.strip()` 去首尾空白（Python str.strip 覆盖空格 / 制表 / 换行及 Unicode 空白）后按**码点数**计（`len()`），上限 280 **含边界**（恰 280 合法、281 拒绝）。多字节 emoji 单码点计 1。纯文本（D2）：不做任何富媒体解析与转义，原样交付存储层。
5. **保存内容为规范化后的文本**：落库 content 为去首尾空白后的文本（长度口径与保存内容一致，避免「按截断口径校验、却存原始空白」的歧义）；`created_at` / `id` 由存储层生成（FP-001 `_now()` UTC ISO 8601），服务层不重复造时间。
6. **非字符串入参**：契约错误语义只覆盖三类业务失败；`content` 非 str 属调用方编程错误，显式抛 `TypeError`（fail-fast，不静默映射为 EMPTY_CONTENT）。`author_id` 不存在即 `AUTHOR_NOT_FOUND`（含 None / 负数等未命中值）。
7. **失败不产生副作用**：三条失败路径均在调用 `store.createPost` 之前返回，帖子集合不增长（验收 §7）；测试同时断言「存储未写入」与「时间线数据字段完整」。

## 目录结构

```
services/
  __init__.py    # 导出 PostService 与 REASON_* / 长度常量
  posting.py     # createPost 服务实现（校验 + 保存）
tests/
  test_posting.py
docs/
  designs/FP-013-post-content-rules.md
  test-cases/FP-013-post-content-rules.md
```

## 非范围提醒

发帖界面与提示展示（FP-012）、posts 持久化本身（FP-001）、时间线可见性 / 聚合 / 排序（FP-014 / FP-015）、删帖 / 编辑（范围外）均不在本任务实现。
