'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Players } = require('../server/players');
const { Rooms } = require('../server/rooms');
const bank = require('../server/questions');
let serial = 0;
const nonce = () => `history-operation-${++serial}`;
function disk(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluff-history-'));
  const file = path.join(dir, 'players.json');
  const stores = [];
  t.after(() => { stores.forEach(p => p.close()); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, file, open() { const p = new Players({ file }); stores.push(p); return p; } };
}
function group(rooms, tokens = []) {
  const sessions = [];
  for (let i = 0; i < 3; i++) sessions.push(rooms.enter({ name: '昵称' + (++serial), requestId: nonce(), profileToken: tokens[i], code: sessions[0]?.code }));
  const action = (i, action, data = {}) => rooms.action(sessions[i].code, sessions[i].token, { action, opId: nonce(), ...data });
  action(0, 'settings', { mode: 'quick' });
  return {
    sessions, action, room: () => rooms.rooms.get(sessions[0].code),
    ready() { sessions.forEach((_, i) => action(i, 'ready', { ready: true })); },
    start() { this.ready(); return action(0, 'start'); },
    leave() { sessions.forEach((_, i) => action(i, 'leave')); }
  };
}
test('whole decks stay excluded across nicknames, rooms and server restarts', t => {
  const d = disk(t), p = d.open();
  let rooms = new Rooms({ players: p, questions: bank.slice(0, 9), random: () => .37 });
  const a = group(rooms); a.start();
  const first = a.room().deck.map(q => q.id), tokens = a.sessions.map(s => s.profileToken);
  assert.equal(p.fromToken(tokens[0]).seen.length, 3, 'reserve unseen future rounds too');
  a.leave(); p.close();
  const restored = d.open();
  rooms = new Rooms({ players: restored, questions: bank.slice(0, 9), random: () => .37 });
  const b = group(rooms, [tokens[0]]);
  assert.equal(b.sessions[0].state.freshCount, 6);
  b.start();
  assert(b.room().deck.every(q => !first.includes(q.id)));
  assert.equal(restored.fromToken(tokens[0]).seen.length, 6);
  const shared = JSON.stringify(rooms.state(b.sessions[0].code, b.sessions[0].token));
  assert(!shared.includes(tokens[0])); assert(!shared.includes(restored.fromToken(tokens[0]).id));
});
test('exclusion is the union of every member history; leaving never recycles a reserved deck', () => {
  const players = new Players(); const rooms = new Rooms({ players, questions: bank.slice(0, 9) });
  const a = group(rooms); a.start(); const first = a.room().deck.map(q => q.id); a.leave();
  const b = group(rooms); b.start(); const second = b.room().deck.map(q => q.id); b.leave();
  const expected = new Set([...first, ...second]);
  const c = group(rooms, [a.sessions[0].profileToken, b.sessions[1].profileToken]);
  assert.equal(rooms.state(c.sessions[0].code, c.sessions[0].token).freshCount, 9 - expected.size);
  c.start(); assert(c.room().deck.every(q => !expected.has(q.id)));
});
test('exhausted online banks reject start without returning any old question', () => {
  const rooms = new Rooms({ questions: bank.slice(0, 6) });
  const a = group(rooms); a.start(); const first = a.room().deck.map(q => q.id); a.leave();
  const tokens = a.sessions.map(s => s.profileToken), b = group(rooms, tokens);
  b.start(); assert(b.room().deck.every(q => !first.includes(q.id))); b.leave();
  const c = group(rooms, tokens); c.ready();
  const s = rooms.state(c.sessions[0].code, c.sessions[0].token);
  assert.equal(s.freshCount, 0); assert.equal(s.canStartFresh, false);
  assert.throws(() => c.action(0, 'start'), /新题只剩0道/);
  assert.equal(c.room().phase, 'lobby'); assert.equal(c.room().deck.length, 0); assert(!s.question);
});
test('one identity cannot occupy two seats, and invalid identity never resets history', () => {
  const rooms = new Rooms(); const registration = 'stable-registration-key-123456';
  const body = { name: '原昵称', requestId: nonce(), profileKey: registration };
  const a = rooms.enter(body); assert.equal(rooms.enter(body).profileToken, a.profileToken);
  for (const identity of [{ profileKey: registration }, { profileToken: a.profileToken }]) {
    assert.throws(() => rooms.enter({ name: '换个昵称', requestId: nonce(), ...identity }), /已在一个房间/);
    assert.throws(() => rooms.enter({ name: '另一席位', requestId: nonce(), code: a.code, ...identity }), /已在一个房间/);
  }
  assert.throws(() => rooms.enter({ name: '假凭证', requestId: nonce(), profileToken: 'f'.repeat(64) }), /不会自动清空历史/);
  assert.equal(Object.keys(rooms.players.data.profiles).length, 1);
});
test('stable question IDs survive wording changes; only genuinely new IDs replenish the bank', () => {
  const players = new Players(), p = players.resolve({ profileKey: 'stable-question-check' });
  players.reserve([p.id], bank.slice(0, 6).map(q => q.id));
  const updated = bank.slice(0, 9).map(q => ({ ...q, q: q.q + '（修订）' }));
  const rooms = new Rooms({ players, questions: updated });
  const a = group(rooms, [p.token]); assert.equal(a.sessions[0].state.freshCount, 3);
  a.start(); assert.deepEqual(new Set(a.room().deck.map(q => q.id)), new Set(bank.slice(6, 9).map(q => q.id)));
});
test('disk write failures prevent revealing a question and preserve committed state', t => {
  const d = disk(t), players = d.open(), rooms = new Rooms({ players });
  const a = group(rooms); a.ready(); const before = fs.readFileSync(d.file, 'utf8');
  players.file = path.join(d.dir, 'missing-parent', 'players.json');
  assert.throws(() => a.action(0, 'start'), /保存失败，本次未发题/);
  assert.equal(a.room().phase, 'lobby'); assert.equal(a.room().deck.length, 0);
  assert(a.sessions.every(s => players.fromToken(s.profileToken).seen.length === 0));
  assert.equal(fs.readFileSync(d.file, 'utf8'), before);
  players.file = d.file; a.action(0, 'start'); assert.equal(a.room().phase, 'write');
});

test('upgrading the original 64-question bank adds 448 fresh questions without resetting history', t => {
  const d = disk(t), original = require('../server/packs/original-64.json');
  let players = d.open();
  const profile = players.resolve({ profileKey: 'original-version-upgrade-player' });
  const token = profile.token;
  players.reserve([profile.id], original.map(q => q.id));
  players.close(); players = d.open();
  const rooms = new Rooms({ players });
  const a = group(rooms, [token]);
  assert.equal(a.sessions[0].state.bankSize, 512);
  assert.equal(a.sessions[0].state.freshCount, 448);
  a.start();
  assert(a.room().deck.every(q => !original.some(old => old.id === q.id)));
  assert.equal(players.fromToken(token).seen.length, 67);
});

test('all 512 questions can be reserved once across 64 rooms and exhaustion never recycles', () => {
  const rooms = new Rooms(); let tokens = [], consumed = new Set();
  for (let i = 0; i < 64; i++) {
    const a = group(rooms, tokens);
    tokens = a.sessions.map(s => s.profileToken);
    a.action(0, 'settings', { mode: 'relaxed' }); a.start();
    assert.equal(a.room().deck.length, 8);
    for (const q of a.room().deck) { assert(!consumed.has(q.id), q.term); consumed.add(q.id); }
    a.leave();
  }
  assert.equal(consumed.size, 512);
  const final = group(rooms, tokens); final.ready();
  assert.equal(final.sessions[0].state.freshCount, 0);
  assert.throws(() => final.action(0, 'start'), /新题只剩0道/);
});
test('corrupt history fails closed and concurrent writers cannot steal the lock', t => {
  const d = disk(t), p = d.open();
  assert.throws(() => new Players({ file: d.file }), /另一个服务/);
  assert.equal(fs.readFileSync(d.file + '.lock', 'utf8'), String(process.pid));
  p.close(); fs.writeFileSync(d.file, '{broken json');
  assert.throws(() => new Players({ file: d.file }), SyntaxError);
  assert.equal(fs.readFileSync(d.file, 'utf8'), '{broken json');
  assert.equal(fs.existsSync(d.file + '.lock'), false);
});
test('verified WeChat identity reunites devices and preserves merged guest history', t => {
  const d = disk(t), players = d.open();
  const guest = players.resolve({ profileKey: 'guest-device-one-123' }); players.reserve([guest.id], ['term:甲']);
  const wx = players.resolve({ profileKey: 'wechat-device-two-123' }, 'appid:verified-openid'); players.reserve([wx.id], ['term:乙']);
  const merged = players.resolve({ profileToken: guest.token }, 'appid:verified-openid');
  assert.equal(merged.id, wx.id); assert.deepEqual(new Set(merged.seen), new Set(['term:甲', 'term:乙']));
  assert.equal(players.fromToken(guest.token).id, wx.id);
  assert.equal(players.resolve({ profileKey: 'different-device-key' }, 'appid:verified-openid').id, wx.id);
  assert(!JSON.stringify(players.data).includes('verified-openid'));
  players.close(); const restored = d.open(); assert.equal(restored.fromToken(guest.token).id, wx.id);
  assert.deepEqual(new Set(restored.fromToken(wx.token).seen), new Set(['term:甲', 'term:乙']));
});
