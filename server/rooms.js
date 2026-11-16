'use strict';
const { randomBytes, randomInt } = require('node:crypto');
const bank = require('./questions');
const { Players } = require('./players');
const questionId = q => q.id || (q.term ? 'term:' + q.term : q.q);
const id = () => randomBytes(16).toString('hex');
const MODES = Object.freeze({
  quick: { name: '闪电局', rounds: 3, writeSeconds: 30, voteSeconds: 20 },
  classic: { name: '经典局', rounds: 5, writeSeconds: 60, voteSeconds: 30 },
  relaxed: { name: '慢慢编', rounds: 8, writeSeconds: 90, voteSeconds: 45 }
});
const clean = value => String(value || '').normalize('NFKC').replace(/[\s，。！？、,.!?]/g, '').toLowerCase();
class RoomError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
class Rooms {
  constructor({ now = Date.now, questions = bank, random = Math.random, players = new Players() } = {}) {
    this.now = now; this.questions = questions; this.random = random; this.players = players;
    this.rooms = new Map(); this.requests = new Map();
  }
  shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  pickDeck(fresh, total) {
    const groups = new Map();
    for (const question of this.shuffle(fresh)) {
      const domain = question.domain || 'other';
      if (!groups.has(domain)) groups.set(domain, []);
      groups.get(domain).push(question);
    }
    const deck = [];
    // 每一遍从每种题材最多取一题；某类耗尽后自然退出，绝不补入旧题。
    while (deck.length < total && groups.size) {
      for (const domain of this.shuffle([...groups.keys()])) {
        const bucket = groups.get(domain);
        deck.push(bucket.pop());
        if (!bucket.length) groups.delete(domain);
        if (deck.length === total) break;
      }
    }
    return deck;
  }
  name(value) {
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 10 || /[\p{Cc}\p{Cf}<>]/u.test(value)) throw new RoomError('昵称请填写1～10个字，不含特殊控制字符。');
    return value.trim();
  }
  touch(r) { r.version++; r.activeAt = this.now(); }
  online(p) { return !p.left && this.now() - p.seen < 15000; }
  active(r) { return r.players.filter(p => !p.left); }
  player(name) { return { id: id(), token: id() + id(), name, ready: false, score: 0, hits: 0, fooled: 0, laughs: 0, seen: this.now(), left: false, seenOps: new Set() }; }
  fresh(r) { const seen = this.players.seen(this.active(r).map(p => p.profileId)); return this.questions.filter(q => !seen.has(questionId(q))); }
  enter(body, verifiedSubject) {
    const name = this.name(body.name);
    if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId)) throw new RoomError('请求标识无效。');
    const profile = this.players.resolve(body, verifiedSubject);
    const prior = this.requests.get(body.requestId);
    if (prior && this.rooms.has(prior.code)) {
      if (prior.profileId !== profile.id || prior.name !== name || prior.join !== (body.code || '')) throw new RoomError('请求标识冲突。');
      const { r, p } = this.auth(prior.code, prior.token); return this.session(r, p);
    }
    // 一个身份只能占一个活跃席位，阻止多标签页分身刷题。
    for (const existing of this.rooms.values()) {
      if (this.active(existing).some(p => this.players.profile(p.profileId).id === profile.id)) throw new RoomError('这个玩家已在一个房间中，请回到原房间或退出后再加入。', 409);
    }
    let r;
    if (body.code) {
      r = this.rooms.get(String(body.code));
      if (!r) throw new RoomError('房间不存在或已过期。', 404);
      if (r.phase !== 'lobby') throw new RoomError('这一局已经开始，请等房主开新局。');
      if (this.active(r).length >= 6) throw new RoomError('房间已满，最多6人。');
      if (this.active(r).some(p => p.name === name)) throw new RoomError('房间内已有同名玩家，换个昵称吧。');
    } else {
      if (this.rooms.size >= 200) throw new RoomError('房间已满，请稍后再试。', 503);
      let code; do { code = String(randomInt(100000, 1000000)); } while (this.rooms.has(code));
      r = { code, phase: 'lobby', players: [], host: null, version: 0, activeAt: this.now(), round: -1, mode: 'classic', total: Math.min(5, this.questions.length), deck: [], deadline: null };
      this.rooms.set(code, r);
    }
    const p = this.player(name); p.profileId = profile.id; r.players.push(p); if (!r.host) r.host = p.id;
    this.touch(r); this.requests.set(body.requestId, { code: r.code, token: p.token, name, profileId: profile.id, join: body.code || '', at: this.now() });
    return this.session(r, p);
  }
  session(r, p) { return { profileToken: this.players.profile(p.profileId).token, code: r.code, token: p.token, playerId: p.id, state: this.view(r, p) }; }
  auth(code, token) {
    const r = this.rooms.get(code);
    if (!r) throw new RoomError('房间已结束或过期，请重新建房。', 404);
    const p = r.players.find(p => p.token === token && !p.left);
    if (!p) throw new RoomError('房间身份已失效，请重新加入。', 401);
    const wasOffline = !this.online(p); p.seen = this.now(); r.activeAt = this.now();
    if (wasOffline) this.touch(r);
    return { r, p };
  }
  state(code, token) { this.tick(); const { r, p } = this.auth(code, token); return this.view(r, p); }
  begin(r) {
    r.round++;
    if (r.round >= r.total) { r.phase = 'result'; r.deadline = null; this.touch(r); return; }
    r.phase = 'write'; r.roundId = id(); r.question = r.deck[r.round];
    r.answers = {}; r.votes = {}; r.funny = {}; r.next = new Set(); r.options = []; r.gains = {};
    r.deadline = this.now() + MODES[r.mode].writeSeconds * 1000; this.touch(r);
  }
  toVote(r) {
    const used = new Set(Object.values(r.answers).filter(Boolean).map(clean));
    const spare = r.question.lies.filter(s => !used.has(clean(s)));
    r.options = [{ id: id(), text: r.question.answer, owner: null, truth: true, fallback: false }];
    for (const p of r.players) {
      const answer = r.answers[p.id];
      r.options.push({ id: id(), text: answer || spare.shift() || '这是一项尚未得到证实的旧说法。', owner: p.id, truth: false, fallback: !answer });
    }
    r.options = this.shuffle(r.options); r.phase = 'vote'; r.deadline = this.now() + MODES[r.mode].voteSeconds * 1000; this.touch(r);
  }
  toReveal(r) { r.phase = 'reveal'; r.revealAt = this.now(); r.deadline = this.now() + 24000; r.scored = false; this.touch(r); }
  stage(r) { return Math.min(2, Math.floor((this.now() - r.revealAt) / 3000)); }
  score(r) {
    if (r.scored) return;
    for (const p of r.players) r.gains[p.id] = 0;
    for (const [voter, choice] of Object.entries(r.votes)) {
      const o = r.options.find(o => o.id === choice), p = r.players.find(p => p.id === voter);
      if (!o || !p) continue;
      if (o.truth) { p.hits++; r.gains[p.id] += 2; }
      else if (!o.fallback) { const owner = r.players.find(p => p.id === o.owner); owner.fooled++; r.gains[owner.id]++; }
    }
    for (const p of r.players) p.score += r.gains[p.id];
    r.scored = true; this.touch(r);
  }
  advanceIfDone(r) {
    const active = this.active(r);
    if (!active.length) return;
    if (r.phase === 'write' && active.every(p => Object.hasOwn(r.answers, p.id))) this.toVote(r);
    else if (r.phase === 'vote' && active.every(p => Object.hasOwn(r.votes, p.id))) this.toReveal(r);
    else if (r.phase === 'reveal' && this.stage(r) === 2 && active.every(p => r.next.has(p.id))) this.begin(r);
  }
  action(code, token, body) {
    this.tick(); const { r, p } = this.auth(code, token);
    if (typeof body.opId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.opId)) throw new RoomError('操作标识无效。');
    if (p.seenOps.has(body.opId)) return this.view(r, p);
    const op = body.action;
    if (['answer', 'vote', 'funny', 'next'].includes(op) && body.roundId !== r.roundId) throw new RoomError('已进入新一轮，请刷新状态后操作。', 409);
    if (op === 'ready') {
      if (r.phase !== 'lobby') throw new RoomError('当前不能准备。');
      p.ready = Boolean(body.ready);
    } else if (op === 'settings') {
      if (r.host !== p.id || r.phase !== 'lobby') throw new RoomError('只有房主能在大厅调整玩法。', 403);
      if (!Object.hasOwn(MODES, body.mode)) throw new RoomError('请选择支持的对局模式。');
      if (body.mode !== r.mode) {
        r.mode = body.mode; r.total = Math.min(MODES[r.mode].rounds, this.questions.length);
        for (const member of r.players) member.ready = false;
      }
    } else if (op === 'start') {
      if (r.host !== p.id || r.phase !== 'lobby') throw new RoomError('只有房主可以开局。', 403);
      if (this.active(r).length < 3 || !this.active(r).every(p => p.ready && this.online(p))) throw new RoomError('需要3～6位在线玩家全部准备。');
      const fresh = this.fresh(r);
      if (fresh.length < r.total) throw new RoomError(`全员都没见过的新题只剩${fresh.length}道，不足${r.total}轮。请选择更短的局或等待新题。`, 409);
      const deck = this.pickDeck(fresh, r.total);
      this.players.reserve(this.active(r).map(p => p.profileId), deck.map(questionId));
      r.deck = deck;
      this.begin(r);
    } else if (op === 'answer') {
      if (r.phase !== 'write' || Object.hasOwn(r.answers, p.id)) throw new RoomError('证词已锁定或提交时间已结束。', 409);
      const value = typeof body.text === 'string' ? body.text.trim() : '';
      if (body.skip !== true && (!value || [...value].length > 30 || /[\p{Cc}\p{Cf}<>]/u.test(value))) throw new RoomError('证词请填写1～30个字，不含特殊控制字符。');
      if (body.skip !== true && [r.question.answer, ...Object.values(r.answers).filter(Boolean)].some(s => clean(s) === clean(value))) throw new RoomError('这份证词撞车了，换一种说法。');
      r.answers[p.id] = body.skip === true ? null : value;
    } else if (op === 'vote') {
      if (r.phase !== 'vote' || Object.hasOwn(r.votes, p.id)) throw new RoomError('投票已锁定或投票时间已结束。', 409);
      const option = r.options.find(o => o.id === body.optionId);
      if (!option || option.owner === p.id) throw new RoomError('请选择其他人的证词。');
      r.votes[p.id] = option.id;
    } else if (op === 'funny') {
      if (r.phase !== 'reveal' || this.stage(r) !== 2 || Object.hasOwn(r.funny, p.id)) throw new RoomError('本轮笑脸已送出或尚未揭晓。');
      const o = r.options.find(o => o.id === body.optionId);
      if (!o || o.truth || o.fallback || o.owner === p.id) throw new RoomError('请为其他玩家原创的瞎掰送笑脸。');
      r.funny[p.id] = o.id; r.players.find(p => p.id === o.owner).laughs++;
    } else if (op === 'next') {
      if (r.phase !== 'reveal' || this.stage(r) !== 2) throw new RoomError('请等待真相揭晓。');
      r.next.add(p.id);
    } else if (op === 'replay') {
      if (r.phase !== 'result' || r.host !== p.id) throw new RoomError('请等房主发起新一局。');
      r.players = r.players.filter(p => !p.left); r.phase = 'lobby'; r.round = -1; r.deadline = null; r.answers = {}; r.votes = {}; r.funny = {}; r.next = new Set(); r.options = []; r.gains = {};
      for (const member of r.players) { member.ready = false; member.score = member.hits = member.fooled = member.laughs = 0; }
    } else if (op === 'remove') {
      if (r.phase !== 'lobby' || r.host !== p.id) throw new RoomError('只有房主能在大厅移除掉线成员。', 403);
      const target = r.players.find(member => member.id === body.playerId);
      if (!target || target.id === p.id || this.online(target)) throw new RoomError('只能移除掉线成员。');
      target.left = true; r.players = r.players.filter(member => !member.left);
    } else if (op === 'leave') {
      p.left = true;
      if (r.phase === 'lobby') r.players = r.players.filter(member => !member.left);
      if (r.host === p.id) r.host = this.active(r).find(member => this.online(member))?.id || this.active(r)[0]?.id || null;
    } else throw new RoomError('未知操作。');
    p.seenOps.add(body.opId); if (p.seenOps.size > 500) p.seenOps.delete(p.seenOps.values().next().value);
    this.touch(r); this.advanceIfDone(r);
    return op === 'leave' ? { left: true } : this.view(r, p);
  }
  tick() {
    for (const [code, r] of this.rooms) {
      if (!this.active(r).length || this.now() - r.activeAt > 3600000) { this.rooms.delete(code); continue; }
      const host = r.players.find(p => p.id === r.host);
      if (!host || host.left || this.now() - host.seen > 30000) {
        const replacement = this.active(r).find(p => this.online(p));
        if (replacement && replacement.id !== r.host) { r.host = replacement.id; this.touch(r); }
      }
      if (r.phase === 'reveal' && this.stage(r) === 2) this.score(r);
      if (r.deadline !== null && this.now() >= r.deadline) {
        if (r.phase === 'write') this.toVote(r);
        else if (r.phase === 'vote') this.toReveal(r);
        else if (r.phase === 'reveal') { this.score(r); this.begin(r); }
      }
    }
    for (const [key, value] of this.requests) if (this.now() - value.at > 3600000 || !this.rooms.has(value.code)) this.requests.delete(key);
  }
  view(r, self) {
    const stage = r.phase === 'reveal' ? this.stage(r) : null;
    const active = this.active(r);
    const state = { code: r.code, version: r.version, serverNow: this.now(), phase: r.phase, self: self.id, host: r.host, round: r.round + 1, roundId: r.roundId, total: r.total, deadline: r.deadline, mode: r.mode, settings: { ...MODES[r.mode], rounds: r.total }, activeCount: active.length,
      players: r.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, score: p.score, hits: p.hits, fooled: p.fooled, laughs: p.laughs, online: this.online(p), left: p.left, answered: Object.hasOwn(r.answers || {}, p.id), voted: Object.hasOwn(r.votes || {}, p.id) })),
      submitted: active.filter(p => Object.hasOwn(r.answers || {}, p.id)).length, voted: active.filter(p => Object.hasOwn(r.votes || {}, p.id)).length,
      answered: Object.hasOwn(r.answers || {}, self.id), myAnswer: r.answers?.[self.id] || '', hasVoted: Object.hasOwn(r.votes || {}, self.id), myVote: r.votes?.[self.id] || null,
      revealStep: stage, nextReady: r.next?.has(self.id) || false, nextCount: r.next?.size || 0, funnySent: Object.hasOwn(r.funny || {}, self.id) };
    const profile = this.players.profile(self.profileId);
    state.identityKind = profile.subject ? 'wechat' : 'guest';
    if (r.phase === 'lobby') { state.bankSize = this.questions.length; state.freshCount = this.fresh(r).length; state.canStartFresh = state.freshCount >= r.total; }
    if (['write', 'vote', 'reveal'].includes(r.phase)) state.question = { q: r.question.q, tag: r.question.tag };
    if (['vote', 'reveal'].includes(r.phase)) state.options = r.options.map(o => {
      const item = { id: o.id, text: o.text, mine: o.owner === self.id };
      if (stage !== null) item.votes = Object.values(r.votes).filter(v => v === o.id).length;
      if (stage >= 1 && stage !== null) item.author = o.truth ? '来源待揭晓' : o.fallback ? '系统补位' : r.players.find(p => p.id === o.owner).name;
      if (stage === 2) { item.truth = o.truth; item.fallback = o.fallback; item.author = o.truth ? '真实答案' : item.author; item.canLaugh = !o.truth && !o.fallback && o.owner !== self.id; }
      return item;
    });
    if (stage === 2) { state.fact = r.question.fact; state.source = r.question.source; state.gains = r.gains; }
    return state;
  }
}
module.exports = { Rooms, RoomError };
