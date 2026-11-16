'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../src/client');
const session = { base: 'http://127.0.0.1:8765', code: '123456', token: 'test-token', playerId: 'player-1' };
const state = extra => ({ code: session.code, self: session.playerId, phase: 'lobby', version: 1, serverNow: 1000, ...extra });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture(t, request) {
  const saved = new Map(); let updates = 0;
  const c = new Client({ request, save: (k, v) => saved.set(k, v) }, () => { updates++; });
  c.configure(session.base); t.after(() => c.close()); return { c, saved, updates: () => updates };
}
test('concurrent polls share one request and preserve newer state', async t => {
  let calls = 0, wait;
  const { c } = fixture(t, async () => { calls++; return wait ? wait.promise : state(); });
  await c.resume(session); calls = 0; wait = deferred();
  const first = c.poll(), second = c.poll(); assert.equal(calls, 1); assert.equal(first, second);
  c.accept(state({ version: 3, serverNow: 3000 }));
  wait.resolve(state({ version: 2, serverNow: 2000 })); await first;
  assert.equal(c.state.version, 3);
});
test('closing while resume is pending cannot restore a closed client', async t => {
  const wait = deferred(); const { c, updates } = fixture(t, () => wait.promise);
  const pending = c.resume(session); c.close(); const before = updates();
  wait.resolve(state()); await pending; assert.equal(c.state, null); assert.equal(updates(), before);
});
test('late polling response cannot bring back a room after leaving', async t => {
  let wait;
  const { c, saved } = fixture(t, async (url, method) => method === 'POST' ? { left: true } : wait ? wait.promise : state());
  await c.resume(session); wait = deferred(); const pending = c.poll();
  await c.action('leave'); wait.resolve(state({ version: 2 })); await pending;
  assert.equal(c.session, null); assert.equal(c.state, null); assert.equal(saved.get('bluff-room'), null);
});
test('offline resume preserves identity and blocks accidental room creation', async t => {
  let offline = true;
  const { c } = fixture(t, async () => { if (offline) throw new Error('offline'); return state(); });
  await c.resume(session); assert.equal(c.connected, false); assert.equal(c.session.token, session.token);
  await assert.rejects(c.enter('新玩家'), /恢复或退出/);
  offline = false; await c.poll(); assert.equal(c.connected, true); assert.equal(c.state.self, session.playerId);
});
test('invalid restored token clears cached session', async t => {
  const { c, saved } = fixture(t, async () => { const e = new Error('身份失效'); e.status = 401; throw e; });
  await c.resume(session); assert.equal(c.session, null); assert.equal(saved.get('bluff-room'), null); assert.equal(c.status, '身份失效');
});
test('leaving locally while offline ignores old request failures', async t => {
  let wait;
  const { c } = fixture(t, async () => wait ? wait.promise : state());
  await c.resume(session); wait = deferred(); const pending = c.poll(); c.forget();
  wait.reject(new Error('offline')); await pending; assert.equal(c.status, '未连接'); assert.equal(c.session, null);
});
test('pause prevents new polls and wake refreshes the current state', async t => {
  let calls = 0;
  const { c } = fixture(t, async () => { calls++; return state({ version: calls }); });
  await c.resume(session); c.pause(); await c.poll(); assert.equal(calls, 1);
  await c.wake(); assert.equal(calls, 2); assert.equal(c.state.version, 2);
});
test('duplicate enter clicks create only one request', async t => {
  const wait = deferred(); let calls = 0;
  const { c } = fixture(t, () => { calls++; return wait.promise; });
  const one = c.enter('玩家'), two = c.enter('玩家'); assert.equal(calls, 1);
  wait.resolve({ ...session, state: state() }); await Promise.all([one, two]); assert.equal(c.state.self, session.playerId);
});
test('same-version late responses cannot rewind the reveal clock', async t => {
  const { c } = fixture(t, async () => state()); await c.resume(session);
  c.accept(state({ version: 5, serverNow: 9000, revealStep: 2 }));
  c.accept(state({ version: 5, serverNow: 6000, revealStep: 1 }));
  assert.equal(c.state.revealStep, 2);
});
test('live session cannot silently switch to another server', async t => {
  const { c } = fixture(t, async () => state()); await c.resume(session);
  assert.throws(() => c.configure('https://example.com'), /先退出/);
});
test('duplicate action shares a request but a different concurrent action is rejected', async t => {
  const wait = deferred(); let posts = 0;
  const { c } = fixture(t, (url, method) => { if (method === 'POST') { posts++; return wait.promise; } return Promise.resolve(state()); });
  await c.resume(session);
  const a = c.action('ready', { ready: true }), b = c.action('ready', { ready: true });
  assert.equal(posts, 1); await assert.rejects(c.action('leave'), /处理中/);
  wait.resolve(state({ version: 2 })); await Promise.all([a, b]); assert.equal(c.state.version, 2);
});
test('player credentials survive leave and a new client; room tokens stay separate', async t => {
  const store = new Map(), bodies = [];
  const platform = { load: k => store.get(k), save: (k, v) => store.set(k, v), request: async (url, method, body) => {
    if (url.endsWith('/api/enter')) { bodies.push(body); return { ...session, profileToken: 'p'.repeat(64), state: state() }; }
    if (body?.action === 'leave') return { left: true };
    return state();
  } };
  const one = new Client(platform, () => {}); one.configure(session.base); t.after(() => one.close());
  await one.enter('昵称一'); await one.action('leave');
  const two = new Client(platform, () => {}); two.configure(session.base); t.after(() => two.close()); await two.enter('昵称二');
  assert.equal(bodies[1].profileToken, 'p'.repeat(64)); assert.equal(bodies[0].profileKey, bodies[1].profileKey);
  assert.notEqual(bodies[0].requestId, bodies[1].requestId); assert.notEqual(bodies[1].profileToken, session.token);
});
test('native login code accompanies entry and a late response still persists durable identity', async t => {
  const wait = deferred(), saved = new Map(); let body;
  const c = new Client({ loginCode: async () => 'wx-code', save: (k, v) => saved.set(k, v), request: async (url, method, value) => { body = value; return wait.promise; } }, () => {});
  t.after(() => c.close()); c.configure(session.base); const pending = c.enter('微信玩家');
  await Promise.resolve(); assert.equal(body.loginCode, 'wx-code'); c.close();
  wait.resolve({ ...session, profileToken: 'p'.repeat(64), state: state() }); await pending;
  assert.equal(saved.get('bluff-player:' + session.base).token, 'p'.repeat(64)); assert.equal(c.session, null);
});
