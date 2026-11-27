import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Server } from 'socket.io';
import { ZodError } from 'zod';
import { config } from './config.js';
import { db, deleteExpiredSessions } from './db.js';
import { registerDiscoveredGames } from './games/loader.js';
import { registerHttp } from './http.js';
import { deleteStaleMatches } from './matches.js';
import { attachRealtime } from './realtime.js';
import { AppError } from './errors.js';

const gameIds = await registerDiscoveredGames();

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: true,
});

await app.register(cookie);
await registerHttp(app);

app.setErrorHandler((err, request, reply) => {
  if (err instanceof AppError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return reply
      .status(400)
      .send({ error: { code: 'invalid_input', message: '请求参数不正确' } });
  }
  request.log.error({ err }, 'unhandled http error');
  return reply.status(500).send({ error: { code: 'internal', message: '服务器开小差了' } });
});

const io = new Server(app.server, {
  path: '/socket.io',
  serveClient: false,
  maxHttpBufferSize: 256 * 1024,
});
attachRealtime(io);

deleteExpiredSessions();
setInterval(deleteExpiredSessions, 6 * 60 * 60 * 1000).unref();

function cleanupStaleMatches(): void {
  const removed = deleteStaleMatches();
  if (removed > 0) app.log.info({ removed }, 'removed stale matches');
}

cleanupStaleMatches();
setInterval(cleanupStaleMatches, 60 * 60 * 1000).unref();

await app.listen({ port: config.port, host: config.host });
app.log.info(
  { port: config.port, host: config.host, db: config.dbPath, base: config.basePath, games: gameIds },
  'bgx server ready',
);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  io.close();
  await app.close();
  db.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
