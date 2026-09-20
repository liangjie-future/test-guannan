/**
 * FP-012 发帖界面对 FP-013 createPost 契约（任务卡 §3.2）的消费端适配。
 *
 * FP-013 的实现产在 Python（services/posting.py），Node Web 进程无法进程内
 * 调用；此处按同一契约形状提供可注入端口 + 内存 Mock 默认实现（§6 策略，
 * 与 src/session-store.js 消费 FP-001 的做法一致）。Mock 校验语义与
 * FP-013 严格对齐：去首尾空白、按码点计、上限 280 含边界、失败不落帖。
 * 跨语言桥接属集成点：替换注入的 createPost 即可，界面逻辑零改动。
 */

export const MAX_POST_LENGTH = 280;

export const STATUS_OK = 'OK';
export const STATUS_ERROR = 'ERROR';

export const REASON_EMPTY_CONTENT = 'EMPTY_CONTENT';
export const REASON_TOO_LONG = 'TOO_LONG';

/** 字数口径（上游 D3）：按 Unicode 码点计（与 FP-013 Python len() 一致，代理对计 1）。 */
export function countCodePoints(text) {
  return Array.from(text).length;
}

/**
 * 内存版发帖服务（契约同 FP-013 §3.2，三态 OK / EMPTY_CONTENT / TOO_LONG）。
 * posts 数组暴露已成功落下的帖子，供验收「失败时帖子未发布」断言。
 */
export function createMockPostService({ now = () => new Date().toISOString() } = {}) {
  const posts = [];
  let nextId = 1;

  return {
    posts,

    createPost(author_id, content) {
      if (typeof content !== 'string') {
        throw new TypeError(`content 必须为字符串，收到 ${typeof content}`);
      }

      const text = content.trim();
      if (!text) {
        return { status: STATUS_ERROR, reason: REASON_EMPTY_CONTENT };
      }
      if (countCodePoints(text) > MAX_POST_LENGTH) {
        return { status: STATUS_ERROR, reason: REASON_TOO_LONG };
      }

      const post = { id: nextId++, author_id, content: text, created_at: now() };
      posts.push(post);
      return { status: STATUS_OK, post };
    },
  };
}
