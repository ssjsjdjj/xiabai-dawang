'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const key = () => randomBytes(32).toString('hex');
class IdentityError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
// 单进程原子快照。损坏、读写失败均阻止发题，不能降级成空历史。
class Players {
  constructor({ file } = {}) {
    this.file = file; this.data = { version: 1, profiles: {} };
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.lock = file + '.lock';
    try {
      try { this.lockFd = fs.openSync(this.lock, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const pid = Number(fs.readFileSync(this.lock, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('玩家记录锁无效，请检查后再启动。');
        let alive = true;
        try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; else throw e; }
        if (alive) throw new Error('玩家记录已被另一个服务使用；请停止旧服务或使用独立的数据目录。');
        fs.unlinkSync(this.lock); this.lockFd = fs.openSync(this.lock, 'wx', 0o600);
      }
      fs.writeFileSync(this.lockFd, String(process.pid)); fs.fsyncSync(this.lockFd);
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (data.version !== 1 || !data.profiles || typeof data.profiles !== 'object' || Array.isArray(data.profiles)) throw new Error('玩家历史文件格式无效。');
        for (const [id, p] of Object.entries(data.profiles)) {
          if (p.id !== id || !/^[a-f0-9]{64}$/.test(p.token) || !Array.isArray(p.seen) || p.seen.some(v => typeof v !== 'string')) throw new Error('玩家历史条目损坏。');
        }
        this.data = data;
        for (const id of Object.keys(data.profiles)) this.profile(id);
      } else this.commit(this.data);
    } catch (error) { this.close(); throw error; }
  }
  commit(data) {
    if (this.closed) throw new IdentityError('玩家记录已关闭，请重新启动服务。', 503);
    if (this.file) {
      const temp = this.file + '.' + key().slice(0, 12) + '.tmp'; let fd;
      try {
        fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        fs.renameSync(temp, this.file);
      } catch (error) {
        if (fd !== undefined) fs.closeSync(fd);
        try { fs.unlinkSync(temp); } catch {}
        throw new IdentityError('玩家记录保存失败，本次未发题。请检查服务器存储后重试。', 503);
      }
    }
    this.data = data;
  }
  profile(id, data = this.data) {
    let p = data.profiles[id]; const visited = new Set();
    while (p?.redirect) {
      if (visited.has(p.id)) throw new Error('玩家记录关联损坏。');
      visited.add(p.id); p = data.profiles[p.redirect];
    }
    if (!p) throw new IdentityError('玩家记录不存在，请联系管理员恢复记录。');
    return p;
  }
  fromToken(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const p = Object.values(this.data.profiles).find(p => p.token === token);
    return p ? this.profile(p.id) : null;
  }
  resolve(body, verifiedSubject) {
    const supplied = body.profileToken ? this.fromToken(body.profileToken) : null;
    if (body.profileToken && !supplied && !verifiedSubject) throw new IdentityError('玩家凭证无法识别；不会自动清空历史。请连接原服务或联系管理员。');
    if (verifiedSubject) {
      const subject = hash('wechat:' + verifiedSubject);
      const data = structuredClone(this.data);
      let p = Object.values(data.profiles).find(p => p.subject === subject && !p.redirect);
      if (!p) {
        if (supplied && !supplied.subject) { p = data.profiles[supplied.id]; p.subject = subject; }
        else { p = { id: key(), token: key(), subject, seen: [] }; data.profiles[p.id] = p; }
      }
      if (supplied && supplied.id !== p.id && !supplied.subject) {
        p.seen = [...new Set([...p.seen, ...supplied.seen])]; data.profiles[supplied.id].redirect = p.id;
      }
      this.commit(data); return this.profile(p.id);
    }
    if (supplied) return supplied;
    const registration = body.profileKey || body.requestId;
    if (typeof registration !== 'string' || !/^[a-zA-Z0-9_-]{16,150}$/.test(registration)) throw new IdentityError('玩家身份初始化失败。');
    const registrationHash = hash(registration);
    const found = Object.values(this.data.profiles).find(p => p.registrationHash === registrationHash);
    if (found) return this.profile(found.id);
    const data = structuredClone(this.data), p = { id: key(), token: key(), registrationHash, seen: [] };
    data.profiles[p.id] = p; this.commit(data); return this.profile(p.id);
  }
  seen(ids) { return new Set(ids.flatMap(id => this.profile(id).seen)); }
  reserve(ids, questionIds) {
    // 整局题组在首次展示前锁定；退出、换房或服务重启都不回收。
    const seen = this.seen(ids);
    if (questionIds.some(id => seen.has(id))) throw new IdentityError('题组已被使用，请重新开始。');
    const data = structuredClone(this.data);
    for (const id of ids) { const p = this.profile(id, data); p.seen = [...new Set([...p.seen, ...questionIds])]; }
    this.commit(data);
  }
  close() {
    if (this.lockFd !== undefined) { fs.closeSync(this.lockFd); this.lockFd = undefined; fs.unlinkSync(this.lock); }
    this.closed = true;
  }
}
module.exports = { Players, IdentityError };
