import { createWebServer } from './server.js';

const port = Number(process.env.PORT ?? 3000);

const server = createWebServer();
server.listen(port, () => {
  console.log(`FP-004 web skeleton listening on http://localhost:${port}`);
});
