import { main } from './server.js';

// `npm start` 与 `./run start --foreground`（node src/server.js）共用同一
// 启动路径：src/config.js 的 loadConfig 是 HOST/PORT/DATA_DIR 的唯一加载点。
main().catch((err) => {
  console.error('[server] failed to start:', err.message);
  process.exit(1);
});
