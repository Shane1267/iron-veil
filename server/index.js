// Operation Iron Veil online server.
//   - serves the built game (dist/) over HTTP, so the same address opens the game
//   - accepts players over WebSocket at /ws and runs the shared world
//   - GET /health answers "ok" with player count (for hosting health checks)
//
// Environment: PORT (default 8080), PVP=1 to allow players to shoot each other,
// MAX_PLAYERS (default 16), MOTD (message shown on joining), STATIC_DIR (default ./dist).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { GameServer } from './GameServer.js';

const PORT = Number(process.env.PORT) || 8080;
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

console.log('[server] generating world…');
const t0 = Date.now();
const server = new GameServer({
  pvp: process.env.PVP === '1',
  maxPlayers: Number(process.env.MAX_PLAYERS) || 16,
  motd: process.env.MOTD || '',
});
console.log(`[server] world ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    const out = { ok: true, players: server.playerCount, tickMs: +server.stats.tickMs.toFixed(2), agents: server.game.ai.agents.length };
    if (url.searchParams.has('detail')) {
      out.list = [...server.game.players.values()].map((p) => ({ name: p.name, alive: p.alive, x: Math.round(p.pos.x), z: Math.round(p.pos.z), shots: p.shots || 0, rejected: p.rejected || 0 }));
      out.ai = server.game.ai.agents.map((a) => ({ id: a.id, f: a.faction, alive: a.alive, hp: Math.round(a.health), x: Math.round(a.pos.x), z: Math.round(a.pos.z), state: a.state }));
    }
    res.end(JSON.stringify(out));
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(STATIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (!fs.existsSync(STATIC_DIR)) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('Iron Veil server is running. Build the game (npm run build) to serve it here.'); return; }
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': TYPES[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    });
    fs.createReadStream(file).pipe(res);
  });
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 256 * 1024 });
server.attach(wss);
server.start();
httpServer.listen(PORT, () => console.log(`[server] listening on port ${PORT} — open http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.stop(); httpServer.close(); process.exit(0); });
