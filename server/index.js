'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Rooms, RoomError } = require('./rooms');
const { Players } = require('./players');
const { wechatVerifier } = require('./wechat');
const root = path.resolve(__dirname, '..');
const assets = new Set(['preview.html', 'src/app.js', 'src/engine.js', 'src/questions.js', 'src/client.js', 'src/room-ui.js', 'src/browser.js']);
function createServer({ rooms = new Rooms(), allowedOrigins = process.env.ALLOWED_ORIGINS || '', requireWechat = process.env.REQUIRE_WECHAT_LOGIN === 'true', verifyWechat = wechatVerifier() } = {}) {
  const limits = new Map();
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const url = new URL(req.url, 'http://localhost');
      const origin = req.headers.origin;
      const permitted = allowedOrigins.split(',').map(s => s.trim()).filter(Boolean);
      const sameHost = origin && ['http:', 'https:'].some(proto => origin === `${proto}//${req.headers.host}`);
      if (origin && !sameHost && !permitted.includes(origin)) throw new RoomError('来源未获允许，请从游戏服务地址打开页面。', 403);
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }); return res.end();
      }
      if (url.pathname === '/health') return send(200, { ok: true, version: require('../package.json').version });
      if (url.pathname.startsWith('/api/')) {
        const now = Date.now();
        const ip = req.socket.remoteAddress || 'unknown';
        const key = ip + (url.pathname === '/api/enter' ? ':enter' : ':api');
        let limit = limits.get(key);
        if (!limit || now - limit.at >= 60000) { limit = { at: now, count: 0 }; limits.set(key, limit); }
        if (++limit.count > (url.pathname === '/api/enter' ? 30 : 1200)) throw new RoomError('操作太频繁，请稍后再试。', 429);
        for (const [k, entry] of limits) if (now - entry.at > 60000) limits.delete(k);
        let body = {};
        if (req.method === 'POST') {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new RoomError('请使用JSON请求。', 415);
          const chunks = []; let bytes = 0;
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) throw new RoomError('请求内容过长。', 413); chunks.push(chunk); }
          try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new RoomError('JSON格式错误。'); }
          if (!body || Array.isArray(body) || typeof body !== 'object') throw new RoomError('请求格式错误。');
        }
        rooms.tick();
        if (req.method === 'POST' && url.pathname === '/api/enter') {
          const subject = body.loginCode ? await verifyWechat(body.loginCode) : null;
          if (requireWechat && !subject && !rooms.players.fromToken(body.profileToken)?.subject) throw new RoomError('此服务只允许微信登录，请从小游戏进入。', 403);
          // OpenID 只接受服务端向微信换取的结果，忽略客户端自报身份。
          return send(200, rooms.enter(body, subject));
        }
        const match = url.pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(action))?$/);
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
        if (match && req.method === 'GET' && !match[2]) return send(200, rooms.state(match[1], token));
        if (match && req.method === 'POST' && match[2]) return send(200, rooms.action(match[1], token, body));
        throw new RoomError('接口不存在。', 404);
      }
      const file = url.pathname === '/' ? 'preview.html' : url.pathname.slice(1);
      if (!['GET', 'HEAD'].includes(req.method) || !assets.has(file)) throw new RoomError('资源不存在。', 404);
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: http:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(path.join(root, file)).pipe(res);
    } catch (error) {
      if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : '服务暂时不可用，请稍后重试。' });
      else res.end();
    }
  });
  const ticker = setInterval(() => rooms.tick(), 500); ticker.unref();
  server.on('close', () => clearInterval(ticker));
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
if (require.main === module) {
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 8765);
  const players = new Players({ file: process.env.PLAYER_DATA_FILE || path.join(root, 'data', 'players.json') });
  const server = createServer({ rooms: new Rooms({ players }) });
  server.on('close', () => players.close());
  const shutdown = () => { server.closeAllConnections(); server.close(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  server.listen(port, host, () => console.log(`瞎掰大王已启动：http://${host}:${port}/preview.html`));
  server.on('error', error => { players.close(); console.error(`启动失败：${error.message}`); process.exitCode = 1; });
}
module.exports = { createServer };
