/**
 * FP-008 表单体读取：聚合请求流 + 上限保护 + urlencoded 解析。
 *
 * 超过上限即停止缓冲、仅排空流（连接语义完整），读完以
 * statusCode=413 拒绝；缺字段由调用方归一为空串（走统一失败路径，不 500）。
 */
export const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

export function readFormBody(request, { limitBytes = DEFAULT_BODY_LIMIT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limitBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        return;
      }
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('error', reject);
  });
}
