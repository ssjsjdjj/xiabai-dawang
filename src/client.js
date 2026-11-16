(function(root) {
  const nonce = () => Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  class RoomClient {
    constructor(platform, onUpdate) {
      this.platform = platform; this.onUpdate = onUpdate; this.session = null; this.state = null;
      this.status = '未连接'; this.connected = false; this.closed = false; this.paused = false;
      this.offset = 0; this.lastTime = 0; this.generation = 0; this.failures = 0;
    }
    configure(base) {
      const value = String(base || '').trim().replace(/\/+$/, '');
      if (!/^https?:\/\/(?:\[[a-f\d:]+\]|[a-z\d.-]+)(?::\d{1,5})?$/i.test(value)) throw new Error('请输入服务地址，例如 http://192.168.1.8:8765');
      if (this.session && value !== this.base) throw new Error('请先退出当前房间，再切换服务。');
      this.base = value;
      const storageKey = 'bluff-player:' + value;
      this.profile = this.platform.load?.(storageKey) || (this.profileBase === value ? this.profile : null) || { key: nonce() + nonce() };
      this.profileBase = value;
      this.platform.save(storageKey, this.profile);
    }
    live(generation) { return !this.closed && generation === this.generation; }
    request(path, body) { return this.platform.request(this.base + path, body === undefined ? 'GET' : 'POST', body, this.session?.token); }
    accept(state) {
      if (!state || state.left || this.closed || !this.session || state.code !== this.session.code || state.self !== this.session.playerId) return;
      if (this.state && (state.version < this.state.version || (state.version === this.state.version && state.serverNow < this.lastTime))) return;
      this.state = state; this.lastTime = state.serverNow; this.offset = state.serverNow - Date.now();
      this.connected = true; this.failures = 0; this.status = '已连接'; this.onUpdate();
    }
    persist() { this.platform.save('bluff-room', this.session ? { ...this.session, base: this.base } : null); }
    schedule(delay) {
      clearTimeout(this.timer);
      if (!this.closed && !this.paused && this.session) this.timer = setTimeout(() => this.poll(), delay);
    }
    clearSession(status = '未连接') {
      this.generation++; clearTimeout(this.timer); this.session = null; this.state = null; this.pending = null;
      this.connected = false; this.polling = null; this.mutating = null; this.lastTime = 0; this.failures = 0; this.entryKey = null;
      this.status = status; this.persist(); this.onUpdate();
    }
    handleFailure(error) {
      if ([401, 404].includes(error.status)) { this.clearSession(error.message); return; }
      this.connected = false; this.failures++;
      this.status = '网络中断，正在重连'; this.onUpdate();
    }
    async enter(name, code) {
      if (this.closed) throw new Error('当前页面已经关闭。');
      if (this.session) throw new Error('请先恢复或退出当前房间。');
      if (this.entering) return this.entering;
      const generation = this.generation;
      const key = `${this.base}:${name}:${code || ''}`;
      if (this.entryKey !== key) { this.entryKey = key; this.entryId = nonce(); }
      const task = (async () => {
        const profileBase = this.base;
        const profile = this.platform.load?.('bluff-player:' + profileBase) || this.profile;
        const loginCode = this.platform.loginCode ? await this.platform.loginCode() : undefined;
        if (!this.live(generation)) return;
        const data = await this.request('/api/enter', { name, code: code || undefined, requestId: this.entryId, profileKey: profile.key, profileToken: profile.token, loginCode });
        if (data.profileToken) {
          this.profile = { key: profile.key, token: data.profileToken };
          this.platform.save('bluff-player:' + profileBase, this.profile);
        }
        if (!this.live(generation)) return;
        this.session = { token: data.token, code: data.code, playerId: data.playerId };
        this.persist(); this.accept(data.state); this.schedule(900);
      })();
      this.entering = task;
      try { return await task; } finally { if (this.entering === task) this.entering = null; }
    }
    async resume(saved) {
      if (this.closed) return;
      if (!saved || !/^\d{6}$/.test(saved.code) || typeof saved.token !== 'string' || typeof saved.playerId !== 'string') { this.clearSession('房间记录无效，请重新加入'); return; }
      this.configure(saved.base);
      if (this.session && this.session.token !== saved.token) throw new Error('请先退出当前房间。');
      this.session = { token: saved.token, code: saved.code, playerId: saved.playerId };
      this.status = '正在恢复房间…'; this.connected = false; this.onUpdate();
      await this.poll();
    }
    async action(action, data = {}) {
      if (this.closed || !this.session) throw new Error('请先加入房间。');
      const generation = this.generation;
      const payload = { action, roundId: this.state?.roundId, ...data };
      const key = JSON.stringify(payload);
      if (this.mutating) { if (this.mutationKey === key) return this.mutating; throw new Error('上一项操作正在处理中，请稍等。'); }
      if (!this.pending || this.pending.key !== key) this.pending = { key, body: { ...payload, opId: nonce() } };
      const body = this.pending.body;
      const task = (async () => {
        let state;
        try { state = await this.request(`/api/rooms/${this.session.code}/action`, body); }
        catch (error) {
          if (!this.live(generation)) return;
          if (action === 'leave' && [401, 404].includes(error.status)) state = { left: true };
          else {
            if (error.status && error.status < 500) this.pending = null;
            if (!error.status || error.status >= 500 || [401, 404].includes(error.status)) this.handleFailure(error);
            this.schedule(error.status === 409 ? 0 : 1000); throw error;
          }
        }
        if (!this.live(generation)) return;
        this.pending = null;
        if (action === 'leave') this.clearSession(); else this.accept(state);
        return state;
      })();
      this.mutationKey = key; this.mutating = task;
      try { return await task; } finally { if (this.mutating === task) this.mutating = null; }
    }
    poll() {
      clearTimeout(this.timer);
      if (this.closed || this.paused || !this.session) return Promise.resolve();
      if (this.polling) return this.polling;
      const generation = this.generation;
      const task = (async () => {
        try {
          const state = await this.request(`/api/rooms/${this.session.code}`);
          if (this.live(generation)) this.accept(state);
        } catch (error) { if (this.live(generation)) this.handleFailure(error); }
        finally {
          if (this.live(generation)) {
            this.polling = null;
            this.schedule(this.connected ? (this.background ? 5000 : 900) : Math.min(8000, 1000 * 2 ** Math.min(this.failures, 3)));
          }
        }
      })();
      this.polling = task; return task;
    }
    pause() { this.paused = true; clearTimeout(this.timer); }
    wake() { if (this.closed || !this.session) return; this.paused = false; this.connected = false; this.status = '正在同步…'; this.onUpdate(); return this.poll(); }
    forget() { this.clearSession(); }
    now() { return Date.now() + this.offset; }
    close() { this.closed = true; this.generation++; clearTimeout(this.timer); }
  }
  if (typeof module !== 'undefined') module.exports = RoomClient; else root.RoomClient = RoomClient;
})(typeof globalThis !== 'undefined' ? globalThis : this);
