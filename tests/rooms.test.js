'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Rooms } = require('../server/rooms');
let serial = 0;
function setup(count = 3) {
  let now = 100000;
  const service = new Rooms({ now: () => now, random: () => 0.37 });
  const sessions = [];
  for (let i = 0; i < count; i++) sessions.push(service.enter({ name: '玩家' + i, requestId: `entry-request-test-${++serial}`, code: sessions[0]?.code }));
  const room = () => service.rooms.get(sessions[0].code);
  const state = i => service.state(sessions[i].code, sessions[i].token);
  const act = (i, action, data = {}) => service.action(sessions[i].code, sessions[i].token, { action, roundId: room()?.roundId, opId: `operation-${++serial}`, ...data });
  const jump = ms => { now += ms; service.tick(); };
  const start = () => { sessions.forEach((_, i) => act(i, 'ready', { ready: true })); return act(0, 'start'); };
  return { service, sessions, room, act, state, jump, start };
}
test('room admission validates capacity, unique names and membership', () => {
  const h = setup(6); const s = h.sessions[0];
  assert.throws(() => h.service.enter({ name: '额外玩家', code: s.code, requestId: 'extra-request-123' }), /已满/);
  assert.throws(() => h.service.state(s.code, 'bad-token'), /身份已失效/);
  assert.throws(() => h.service.enter({ name: '<script>', requestId: 'invalid-name-12345' }), /昵称/);
  assert(!JSON.stringify(h.state(0)).includes(s.token));
});
test('creation and action retry are idempotent', () => {
  const service = new Rooms();
  const request = { name: '房主', requestId: 'repeat-request-12345' };
  const a = service.enter(request), b = service.enter(request);
  assert.equal(a.token, b.token); assert.equal(service.rooms.size, 1);
  const body = { action: 'ready', ready: true, opId: 'repeat-action-123' };
  const first = service.action(a.code, a.token, body); const second = service.action(a.code, a.token, body);
  assert.equal(first.version, second.version); assert.equal(second.players[0].ready, true);
});
test('only host starts when 3–6 online players are ready; late join is blocked', () => {
  const h = setup();
  assert.throws(() => h.act(0, 'start'), /全部准备/);
  assert.throws(() => h.act(1, 'start'), /房主/);
  h.start();
  assert.throws(() => h.service.enter({ name: '迟到的人', code: h.sessions[0].code, requestId: 'late-request-12345' }), /已经开始/);
});
test('question truth, other answers and identity are hidden before reveal', () => {
  const h = setup(); h.start();
  const q = h.room().question;
  h.act(0, 'answer', { text: '古人用来测量潮汐的办法' });
  assert(!JSON.stringify(h.state(1)).includes('古人用来测量潮汐的办法'));
  assert(!JSON.stringify(h.state(1)).includes(q.answer));
  assert(!JSON.stringify(h.state(1)).includes(q.source.url));
  assert(!Object.hasOwn(h.state(1), 'source'));
  h.act(1, 'answer', { text: '一种宫廷音乐的名字' }); h.act(2, 'answer', { text: '来自古代纺织技术' });
  const s = h.state(0); assert.equal(s.phase, 'vote');
  for (const o of s.options) { assert(!Object.hasOwn(o, 'truth')); assert(!Object.hasOwn(o, 'author')); assert(!Object.hasOwn(o, 'owner')); assert(!['truth', 'self'].includes(o.id)); }
  assert(!Object.hasOwn(s, 'fact')); assert(!Object.hasOwn(s.question, 'answer'));
  assert(!Object.hasOwn(s, 'source'));
  const truth = h.room().options.find(o => o.truth);
  h.sessions.forEach((_, i) => h.act(i, 'vote', { optionId: truth.id }));
  assert(!Object.hasOwn(h.state(0), 'source'));
  h.jump(3000); assert(!Object.hasOwn(h.state(0), 'source'));
  h.jump(3000); assert.deepEqual(h.state(0).source, q.source);
});
test('self-vote and wrong-round actions rejected; scoring delayed and applied once', () => {
  const h = setup(); h.start();
  h.sessions.forEach((_, i) => h.act(i, 'answer', { text: '假答案编号' + i }));
  const options = h.room().options;
  const own = options.find(o => o.owner === h.sessions[0].playerId);
  const truth = options.find(o => o.truth);
  assert.throws(() => h.act(0, 'vote', { optionId: own.id }), /其他人/);
  assert.throws(() => h.act(0, 'vote', { optionId: truth.id, roundId: 'old-round' }), /新一轮/);
  h.act(0, 'vote', { optionId: truth.id }); h.act(1, 'vote', { optionId: own.id }); h.act(2, 'vote', { optionId: own.id });
  assert.equal(h.state(0).phase, 'reveal'); assert(h.state(0).players.every(p => p.score === 0));
  h.jump(3000); assert.equal(h.state(0).revealStep, 1); assert(!Object.hasOwn(h.state(0).options[0], 'truth'));
  h.jump(3000); assert.equal(h.state(0).players[0].score, 4); assert.equal(h.state(0).gains[h.sessions[0].playerId], 4);
  h.service.tick(); assert.equal(h.state(0).players[0].score, 4);
  h.act(1, 'funny', { optionId: own.id }); assert.equal(h.state(0).players[0].laughs, 1);
  assert.throws(() => h.act(1, 'funny', { optionId: own.id }), /已送出/);
  assert.equal(h.state(0).players[0].score, 4);
});
test('timeouts preserve progression and fallback cannot earn deception points', () => {
  const h = setup(); h.start(); h.jump(60000);
  assert.equal(h.state(0).phase, 'vote');
  const own = h.room().options.find(o => o.owner === h.sessions[0].playerId);
  h.act(1, 'vote', { optionId: own.id }); h.act(2, 'vote', { optionId: own.id });
  h.jump(30000); assert.equal(h.state(0).phase, 'reveal');
  h.jump(6000); assert.equal(h.state(0).players[0].score, 0);
  h.jump(18000); assert.equal(h.state(0).phase, 'write'); assert.equal(h.state(0).round, 2);
});
test('resume returns the same identity, host transfers, offline lobby member can be removed', () => {
  const h = setup(); h.act(1, 'ready', { ready: true }); h.jump(14000); h.state(1); h.jump(14000); h.state(1); h.jump(3000);
  const state = h.state(1); assert.equal(state.host, h.sessions[1].playerId);
  const resumed = h.state(0); assert.equal(resumed.self, h.sessions[0].playerId); assert.equal(resumed.players[0].online, true);
  h.act(1, 'remove', { playerId: h.sessions[2].playerId }); assert.equal(h.state(1).players.length, 2);
  assert.throws(() => h.state(2), /身份已失效/);
  assert.throws(() => h.act(1, 'remove', { playerId: h.sessions[0].playerId }), /掉线成员/);
});
test('leaving during a round does not block the remaining players', () => {
  const h = setup(); h.start(); h.act(0, 'leave');
  h.act(1, 'answer', { text: '一种花草的名称' }); h.act(2, 'answer', { text: '古时候的交通工具' });
  assert.equal(h.state(1).phase, 'vote'); assert.equal(h.state(1).host, h.sessions[1].playerId);
  assert.throws(() => h.state(0), /身份已失效/);
});
test('five rounds finish, ties are preserved, host can reset lobby', () => {
  const h = setup(); h.start();
  for (let round = 0; round < 5; round++) {
    h.sessions.forEach((_, i) => h.act(i, 'answer', { text: '编的答案' + i }));
    const truth = h.room().options.find(o => o.truth);
    h.sessions.forEach((_, i) => h.act(i, 'vote', { optionId: truth.id }));
    h.jump(6000);
    h.sessions.forEach((_, i) => h.act(i, 'next'));
  }
  const state = h.state(0); assert.equal(state.phase, 'result'); assert.deepEqual(state.players.map(p => p.score), [10, 10, 10]);
  assert.throws(() => h.act(1, 'replay'), /房主/);
  const lobby = h.act(0, 'replay'); assert.equal(lobby.phase, 'lobby'); assert(lobby.players.every(p => !p.ready && !p.score)); assert.equal(lobby.myAnswer, '');
});
test('idle rooms and entry idempotency records expire', () => { const h = setup(); h.jump(3600001); assert.equal(h.service.rooms.size, 0); assert.equal(h.service.requests.size, 0); });
test('room modes reset readiness, require host and change authoritative timers', () => {
  const h = setup(); h.act(1, 'ready', { ready: true });
  assert.throws(() => h.act(1, 'settings', { mode: 'quick' }), /房主/);
  assert.throws(() => h.act(0, 'settings', { mode: 'unlimited' }), /支持的/);
  let s = h.act(0, 'settings', { mode: 'quick' });
  assert.equal(s.total, 3); assert(s.players.every(p => !p.ready));
  s = h.start(); assert.equal(s.deadline - s.serverNow, 30000);
  h.jump(30000); s = h.state(0); assert.equal(s.phase, 'vote'); assert.equal(s.deadline - s.serverNow, 20000);
  assert.throws(() => h.act(0, 'settings', { mode: 'relaxed' }), /房主/);
});
test('replay prioritizes questions not played in the previous match', () => {
  const h = setup(); h.act(0, 'settings', { mode: 'quick' }); h.start();
  const first = h.room().deck.map(q => q.q);
  for (let i = 0; i < 3; i++) { h.jump(30000); h.jump(20000); h.jump(24000); }
  assert.equal(h.state(0).phase, 'result');
  h.act(0, 'replay'); h.start();
  const second = h.room().deck.map(q => q.q);
  assert.equal(second.filter(q => first.includes(q)).length, 0);
});
test('progress counts exclude players who left the room', () => {
  const h = setup(); h.start(); h.act(0, 'answer', { text: '假答案' }); h.act(0, 'leave');
  const s = h.state(1); assert.equal(s.activeCount, 2); assert.equal(s.submitted, 0);
  assert.equal(s.players.find(p => p.id === h.sessions[0].playerId).left, true);
  assert.equal(s.players.find(p => p.id === h.sessions[0].playerId).answered, true);
});

test('matches spread topics without exposing topic metadata before reveal', () => {
  const h = setup(); h.act(0, 'settings', { mode: 'relaxed' }); h.start();
  assert.equal(new Set(h.room().deck.map(q => q.domain)).size, 8);
  assert.deepEqual(Object.keys(h.state(0).question).sort(), ['q', 'tag']);
  const room = new Rooms({ random: () => .5 });
  const sparse = [{ id: 'a', domain: 'plant' }, { id: 'b', domain: 'plant' }, { id: 'c', domain: 'food' }];
  const picked = room.pickDeck(sparse, 3);
  assert.equal(new Set(picked.slice(0, 2).map(q => q.domain)).size, 2);
  assert.deepEqual(new Set(picked.map(q => q.id)), new Set(['a', 'b', 'c']));
  assert.deepEqual(room.pickDeck([], 8), []);
});
