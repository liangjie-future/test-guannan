# 测试场景 TG-N01：登录页密码显示/隐藏

测试文件：`tests/login-page.test.js`（渲染契约）、`tests/login-flow.test.js`（真实路由渲染与登录回归）、`tests/browser/login-password-toggle.spec.js`（真实 Chromium 交互）。

## 渲染

| 场景 | 期望 |
| --- | --- |
| 初始登录页 | 密码框为 `type=password`；按钮为 `type=button`，文字为“显示密码”，`aria-pressed=false`，`aria-controls=login-password` |
| 失败重渲染 | 密码框和按钮恢复默认隐藏状态；统一错误提示仍存在；用户名和密码不回填 |
| 新导航 | 每次 GET `/login` 均为默认隐藏状态，不携带上一页面状态 |
| 无脚本 | 页面仍有原生密码输入和 `type=submit` 登录按钮，表单 action/method 不变 |
| 注册页隔离 | `/register` 不增加本控件或登录页脚本 |

## 浏览器交互验收

需在真实浏览器打开 `/login` 检查以下场景，不以“HTML 中存在按钮”代替交互验收：

1. 鼠标点击：密码框在 password/text 间切换，按钮文字和 `aria-pressed` 同步，用户名/密码值保持，URL 不变且不发 POST。
2. Tab + Enter：按钮可聚焦，Enter 切换状态且焦点仍在按钮。
3. Tab + Space：Space 切换状态且焦点仍在按钮，不提交表单。
4. 正常登录：点击原“登录”提交按钮仍按原流程 POST `/login`。
5. 失败后刷新：响应重新渲染为隐藏状态，错误提示统一，输入不回填。
6. 禁用 JavaScript：密码输入和登录提交仍可用。

## 回归命令

```bash
npm test
npm run test:browser
python3 -m pytest -q
```

CI 使用 Ubuntu、Node 20、Chromium 和 Python 3.12 执行上述命令。Python 依赖由
`requirements-dev.txt` 安装；本地等价步骤为 `python3 -m pip install -r requirements-dev.txt`。
验证报告应记录每条命令的退出码和测试摘要，不能以未安装 pytest 的环境结果作为通过依据。

## 最近验证报告

| 命令 | 退出码 | 摘要 |
| --- | ---: | --- |
| `npm test` | 0 | 166 passed |
| `python3 -m pytest -q` | 0 | 223 passed in 9.99s |
| `npm run test:browser` | CI required | 3 Chromium interaction tests; browser is installed by the CI workflow |

当前开发容器没有可执行的浏览器运行时，因而不能把本地缺少浏览器的启动错误记录为交互测试通过；合并门禁中的 Ubuntu CI 必须执行并报告该命令的实际退出码。
