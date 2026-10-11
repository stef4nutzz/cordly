import 'dotenv/config';

const dev = process.argv.includes('--dev');
if (!Reflect.set(process.env, 'NODE_ENV', dev ? 'development' : 'production')) {
  throw new Error('Could not set NODE_ENV for the Cordly server.');
}

const hostname = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3000', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port between 1 and 65535.');
}

async function startServer() {
  const [{ default: next }, { createServer }, { attachRealtimeServer }] = await Promise.all([
    import('next'),
    import('node:http'),
    import('./src/server/realtime-server'),
  ]);

  const app = next({ dev, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const httpServer = createServer((request, response) => {
    void handle(request, response);
  });
  const io = attachRealtimeServer(httpServer);

  httpServer.listen(port, hostname, () => {
    console.info(`Cordly ${dev ? 'development' : 'production'} server listening on http://${hostname}:${port}`);
  });

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    io.close(() => process.exit(0));
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void startServer().catch((error: unknown) => {
  console.error('Cordly failed to start:', error);
  process.exitCode = 1;
});
