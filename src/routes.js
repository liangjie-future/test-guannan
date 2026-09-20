import { loginPageContent } from './login-page.js';
import { createTimelinePage } from './timeline.js';

function placeholderContent(pageTitle, owner) {
  return `<section>
  <h1>${pageTitle}</h1>
  <p>本页面为 FP-004 布局骨架占位：页面本体由 ${owner} 实现，并以内容区挂载进统一布局（联调对齐）。</p>
</section>`;
}

/**
 * 路由表工厂：FP-008 起 /login 为真实登录页（静态 loginPageContent），
 * FP-014 起 /timeline 为真实页面（按登录用户经 getTimeline 渲染），
 * 其余入口保持 FP-004 占位内容区（静态字符串）。route.render 存在时以
 * render({ request, user }) 动态产出内容区，否则取静态 route.content。
 * FP-006 起 /register、FP-012 起 /compose 均不入本表：
 * 分别由 server.js 经 register-page / compose 模块分发实页。
 */
export function createRoutes({ getTimeline } = {}) {
  const timelinePage = createTimelinePage({ getTimeline });

  return {
    '/': {
      title: '页面骨架演示页',
      content: `<section>
  <h1>页面骨架演示页</h1>
  <p>本页面用于验证 FP-004 统一布局装配：页头导航 + 内容区 + 页脚。</p>
  <p>五个导航入口：注册 / 登录 / 用户列表 / 发帖 / 时间线，均以内容区挂载进本布局。</p>
  <p>导航登录态由 currentUser 注入点提供（FP-003 会话管理联调；未合入时默认未登录）。</p>
</section>`,
    },
    '/login': {
      title: '登录',
      content: loginPageContent(),
    },
    '/users': {
      title: '用户列表',
      content: placeholderContent('用户列表', 'FP-010 用户列表'),
    },
    // '/compose' 由 FP-012 发帖界面实装（src/compose.js：GET 表单 / POST 提交），
    // 不在静态占位表内，由 src/server.js 单独分发。
    '/timeline': {
      title: '时间线',
      render: ({ user }) =>
        user ? timelinePage.render(user) : timelinePage.renderAnonymous(),
    },
    '/logout': {
      title: '退出',
      content: placeholderContent('退出', 'FP-003 logout / FP-008 退出入口'),
    },
  };
}
