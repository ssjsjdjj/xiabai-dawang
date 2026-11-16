'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Rooms } = require('../server/rooms');
const Client = require('../src/client');
const start = require('../src/room-ui');
let serial = 0;
const settle = () => new Promise(resolve => setImmediate(resolve));
function data(count = 3) {
  const service = new Rooms(); const sessions = [];
  for (let i = 0; i < count; i++) sessions.push(service.enter({ name: '界面玩家' + i, code: sessions[0]?.code, requestId: 'ui-request-test-' + ++serial }));
  const act = (i, action, extra = {}) => service.action(sessions[i].code, sessions[i].token, { action, opId: 'ui-operation-' + ++serial, roundId: service.rooms.get(sessions[0].code).roundId, ...extra });
  const launch = () => { sessions.forEach((_, i) => act(i, 'ready', { ready: true })); act(0, 'start'); };
  const saved = { ...sessions[0], base: 'http://127.0.0.1:8765' }; delete saved.state;
  return { service, sessions, act, launch, store: new Map([['bluff-room', saved]]) };
}
function ui(t, d, { safe = false, offline = false } = {}) {
  let tap, input, copied; let words = [], returned = false;
  const ctx = new Proxy({ setTransform() { words = []; }, measureText: s => ({ width: [...s].length * 12 }), fillText: s => words.push(String(s)) }, { get: (o, k) => k in o ? o[k] : () => {} });
  const platform = {
    canvas: { getContext: () => ctx }, size: () => safe ? ({ width: 320, height: 640, dpr: 2, safeTop: 44, safeBottom: 20 }) : ({ width: 390, height: 844, dpr: 2 }),
    serverBase: 'http://127.0.0.1:8765', load: key => d.store.get(key), save: (key, value) => d.store.set(key, value),
    onTap: fn => { tap = fn; }, onResize() {}, closeInput() {}, input: (value, callback, options) => { input = { value, callback, options }; }, copy(value, done) { copied = value; done(); },
    async request(url, method, body, token) {
      if (offline) throw new Error('没有网络');
      const code = d.sessions[0].code;
      return method === 'POST' ? d.service.action(code, token, body) : d.service.state(code, token);
    }
  };
  const app = start(platform, Client, () => { returned = true; }); t.after(() => app.destroy());
  return { app, words: () => words, returned: () => returned, input: () => input, copied: () => copied, tap(x, y) { const scale = safe ? (640 - 44 - 20) / 844 : 1; const offset = safe ? (320 - 390 * scale) / 2 : 0; tap(offset + x * scale, (safe ? 44 : 0) + y * scale); } };
}
test('draft survives recreating the screen and can be submitted after resume', async t => {
  const d = data(); d.launch(); let screen = ui(t, d); await settle();
  screen.tap(90, 360); assert.equal(screen.input().options.live, true);
  screen.input().callback('刷新之后也不会丢失的瞎掰'); assert.match(d.store.get('bluff-draft').text, /不会丢失/);
  screen.app.destroy(); screen = ui(t, d); await settle();
  assert(screen.words().some(s => s.includes('不会丢失')));
  d.act(1, 'answer', { text: '另一份假答案' }); d.act(2, 'answer', { text: '第三份假答案' });
  screen.tap(100, 670); await settle();
  assert.equal(screen.app.client.state.answered, true); assert.equal(d.store.get('bluff-draft'), null);
});
test('voting selects first and only locks after explicit confirmation', async t => {
  const d = data(6); d.launch(); d.sessions.forEach((_, i) => d.act(i, 'answer', { text: '这是界面测试假答案' + i }));
  const screen = ui(t, d); await settle();
  const s = screen.app.client.state; const index = s.options.findIndex(o => !o.mine);
  screen.tap(110, 310 + index * 56); await settle();
  assert.equal(screen.app.client.state.hasVoted, false); assert(screen.words().some(s => s.includes('确认后')));
  screen.tap(110, 757); await settle();
  assert.equal(screen.app.client.state.hasVoted, true); assert.equal(screen.app.client.state.myVote, s.options[index].id);
});
test('host mode selector saves settings and requires everyone to ready again', async t => {
  const d = data(); d.act(1, 'ready', { ready: true }); const screen = ui(t, d); await settle();
  screen.tap(100, 292); assert(screen.words().includes('选一个合适的节奏'));
  screen.tap(100, 340); await settle();
  assert.equal(screen.app.client.state.mode, 'quick'); assert(screen.app.client.state.players.every(p => !p.ready));
});
test('safe-area scaling preserves the input hit target on small phones', async t => {
  const d = data(); d.launch(); const screen = ui(t, d, { safe: true }); await settle();
  screen.tap(100, 360); assert(screen.input());
});
test('offline room recovery offers local exit without starting another room', async t => {
  const d = data(); const screen = ui(t, d, { offline: true }); await settle();
  assert(screen.words().includes('正在找回你的房间'));
  screen.tap(320, 70); assert(screen.words().includes('仅退出本机'));
  screen.tap(280, 460); await settle();
  assert.equal(screen.app.client.session, null); assert.equal(screen.returned(), true);
});
test('revealed explanation shows and copies its original source', async t => {
  const d = data(); let now = Date.now(); d.service.now = () => now; d.launch();
  d.sessions.forEach((_, i) => d.act(i, 'answer', { text: '来源测试假答案' + i }));
  const room = d.service.rooms.get(d.sessions[0].code);
  const truth = room.options.find(o => o.truth);
  d.sessions.forEach((_, i) => d.act(i, 'vote', { optionId: truth.id }));
  now += 6000; d.service.tick();
  const screen = ui(t, d); await settle();
  screen.tap(100, 700); assert(screen.words().includes('原来如此！'));
  assert(screen.words().some(s => s.includes(room.question.source.title)));
  screen.tap(100, 533); assert.equal(screen.copied(), room.question.source.url);
});
test('lobby blocks an overlong match and permits switching to an available shorter match', async t => {
  const d = data(6), bank = d.service.questions;
  const p = d.service.players.fromToken(d.sessions[5].profileToken);
  d.service.players.reserve([p.id], bank.slice(0, bank.length - 3).map(q => q.id));
  d.sessions.forEach((_, i) => d.act(i, 'ready', { ready: true }));
  const screen = ui(t, d); await settle();
  assert.equal(screen.app.client.state.freshCount, 3); assert.equal(screen.app.client.state.canStartFresh, false);
  assert(screen.words().some(s => s.includes(`全员未见 3 / ${bank.length} 道`)));
  assert(screen.words().some(s => s.includes('新题不足')));
  screen.tap(280, 700); await settle(); assert.equal(screen.app.client.state.phase, 'lobby');
  screen.tap(100, 292); screen.tap(100, 340); await settle();
  assert.equal(screen.app.client.state.mode, 'quick'); assert.equal(screen.app.client.state.canStartFresh, true);
  d.sessions.forEach((_, i) => d.act(i, 'ready', { ready: true })); await screen.app.client.poll();
  screen.tap(280, 700); await settle(); assert.equal(screen.app.client.state.phase, 'write');
});
