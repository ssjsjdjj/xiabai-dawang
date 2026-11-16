'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../server');
const { Rooms } = require('../server/rooms');
const Client = require('../src/client');
async function fixture(t) {
  let now = Date.now(); const rooms = new Rooms({ now: () => now });
  const server = createServer({ rooms }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { rooms, base, jump(ms) { now += ms; rooms.tick(); } };
}
function client(base) {
  const store = new Map(); let drop = false;
  const platform = { save: (k, v) => store.set(k, v), async request(url, method, body, token) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const value = await res.json();
    if (!res.ok) { const error = new Error(value.error); error.status = res.status; throw error; }
    if (drop && body?.action) { drop = false; throw new Error('模拟响应在网络中丢失'); }
    return value;
  } };
  const c = new Client(platform, () => {}); c.configure(base); c.dropNext = () => { drop = true; }; c.saved = () => store.get('bluff-room'); return c;
}
test('three independent HTTP clients finish five rounds, resume and leave', async t => {
  const h = await fixture(t); const clients = [client(h.base), client(h.base), client(h.base)];
  t.after(() => clients.forEach(c => c.close()));
  await clients[0].enter('联网甲');
  await clients[1].enter('联网乙', clients[0].session.code); await clients[2].enter('联网丙', clients[0].session.code);
  for (const c of clients) await c.action('ready', { ready: true });
  await clients[0].action('start');
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 3; i++) { await clients[i].poll(); await clients[i].action('answer', { text: `联网玩家${i}编的假答案` }); }
    const room = h.rooms.rooms.get(clients[0].session.code); const truth = room.options.find(o => o.truth);
    for (const c of clients) { await c.poll(); await c.action('vote', { optionId: truth.id }); }
    h.jump(6000);
    for (const c of clients) { await c.poll(); assert.equal(c.state.revealStep, 2); await c.action('next'); }
  }
  await clients[0].poll(); assert.equal(clients[0].state.phase, 'result'); assert.deepEqual(clients[0].state.players.map(p => p.score), [10, 10, 10]);
  const saved = clients[1].saved(); clients[1].close();
  const resumed = client(h.base); clients.push(resumed); await resumed.resume(saved);
  assert.equal(resumed.state.self, saved.playerId); assert.equal(resumed.state.players.find(p => p.id === saved.playerId).score, 10);
  await resumed.action('leave'); assert.equal(resumed.session, null);
});
test('lost HTTP response can retry the exact action without another mutation', async t => {
  const h = await fixture(t); const c = client(h.base); t.after(() => c.close()); await c.enter('重试玩家');
  c.dropNext(); await assert.rejects(c.action('ready', { ready: true }), /丢失/);
  const version = h.rooms.rooms.get(c.session.code).version;
  await c.action('ready', { ready: true }); assert.equal(c.state.version, version);
});
test('HTTP rejects leaked server assets, bad tokens, malformed JSON and unwanted origins', async t => {
  const h = await fixture(t);
  for (const path of ['/data/players.json', '/data/players.json.lock', '/server/players.js', '/server/wechat.js', '/.env', '/server/questions.js', '/server/packs/rare-2026-10.json', '/server/packs/original-64.json', '/scripts/check-bank.js', '/server/rooms.js', '/package.json', '/tests/rooms.test.js', '/%2e%2e/server/questions.js']) assert.equal((await fetch(h.base + path)).status, 404);
  assert.equal((await fetch(h.base + '/preview.html')).status, 200);
  assert.equal((await fetch(h.base + '/src/client.js')).status, 200);
  assert.equal((await fetch(h.base + '/health')).status, 200);
  assert.equal((await fetch(h.base + '/api/enter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(h.base + '/api/enter', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unwanted.example' }, body: '{}' })).status, 403);
  const c = client(h.base); t.after(() => c.close()); await c.enter('接口测试员');
  assert.equal((await fetch(h.base + '/api/rooms/' + c.session.code)).status, 401);
});
