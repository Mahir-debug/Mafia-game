import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { MafiaGameServer } from './src/server/gameEngine.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const distDir = path.resolve(__dirname, 'dist');
const isProd =
  process.env.NODE_ENV === 'production' ||
  (process.env.npm_lifecycle_event !== 'dev' && fs.existsSync(distDir));

async function bootstrap() {
  const app = express();
  app.use(express.json());

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  const gameServer = new MafiaGameServer();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: isProd ? 'production' : 'development', timestamp: Date.now() });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: gameServer.getRoomSummaries() });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const aliveSockets = new WeakSet<WebSocket>();

  wss.on('connection', (ws) => {
    aliveSockets.add(ws);

    ws.on('pong', () => {
      aliveSockets.add(ws);
    });

    ws.on('message', (data) => {
      aliveSockets.add(ws);
      gameServer.handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
      gameServer.handleDisconnect(ws);
    });

    ws.on('error', () => {
      gameServer.handleDisconnect(ws);
    });
  });

  // Keep WebSocket connections alive behind Cloud Run / Render / Railway proxies
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!aliveSockets.has(client)) {
        client.terminate();
        continue;
      }
      aliveSockets.delete(client);
      if (client.readyState === 1) {
        client.ping();
      }
    }
  }, 25_000);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Nocturne Mafia server listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`
    );
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
