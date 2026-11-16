'use strict';
const canvas = document.querySelector('canvas'), dialog = document.querySelector('dialog'), input = document.querySelector('textarea');
let liveInput = false;
let onChange = null, tap = () => {}, resize = () => {}, current;
const platform = {
  canvas,
  serverBase: location.protocol.startsWith('http') ? location.origin : '',
  size() { const r = canvas.getBoundingClientRect(); return { width: r.width, height: r.height, dpr: devicePixelRatio || 1 }; },
  input(value, cb, options = {}) {
    onChange = cb; liveInput = Boolean(options.live); input.value = value; input.maxLength = options.maxLength || 30;
    document.querySelector('#input-title').textContent = options.title || '提交你的证词';
    document.querySelector('#input-hint').textContent = `最多 ${input.maxLength} 字。`;
    document.querySelector('#save').textContent = '确认保存'; input.placeholder = options.title || '我觉得这一定是因为……';
    if (!dialog.open) dialog.showModal(); input.focus();
  },
  closeInput() { dialog.close(); onChange = null; },
  onTap(fn) { tap = fn; }, onResize(fn) { resize = fn; },
  load(key) { try { return JSON.parse((['bluff-room', 'bluff-draft'].includes(key) ? sessionStorage : localStorage).getItem(key)); } catch { return null; } },
  save(key, value) { try { const store = ['bluff-room', 'bluff-draft'].includes(key) ? sessionStorage : localStorage; if (value === null) store.removeItem(key); else store.setItem(key, JSON.stringify(value)); } catch { /* 私密浏览环境仍允许临时游玩。 */ } },
  async request(url, method, body, token) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: 'no-store' });
      const value = await res.json();
      if (!res.ok) { const error = new Error(value.error || '请求失败'); error.status = res.status; throw error; }
      return value;
    } catch (error) { if (error.status) throw error; throw new Error('连不上房间服务，请检查地址和网络。'); }
    finally { clearTimeout(timeout); }
  },
  async copy(value, done) { try { await navigator.clipboard.writeText(value); done(); } catch { window.prompt('复制下方内容', value); } },
  openOnline() { showOnline(); }
};
input.addEventListener('input', () => { if (liveInput && onChange) onChange(input.value); document.querySelector('#input-hint').textContent = `${[...input.value].length} / ${input.maxLength} 字${liveInput ? ' · 草稿自动保存' : ''}`; });
document.querySelector('#save').onclick = () => { const cb = onChange; dialog.close(); if (cb) cb(input.value); onChange = null; };
document.querySelector('#cancel').onclick = () => platform.closeInput();
document.addEventListener('visibilitychange', () => { if (current?.client) { current.client.background = document.hidden; if (!document.hidden) current.client.wake(); } });
window.addEventListener('online', () => current?.client?.wake());
canvas.addEventListener('pointerup', e => { const r = canvas.getBoundingClientRect(); tap(e.clientX - r.left, e.clientY - r.top); });
window.addEventListener('resize', () => resize());
function showHome() { current?.destroy(); current = startBluffGame(platform, GameEngine, Questions); }
function showOnline(code) { current?.destroy(); current = startRoomUI(platform, RoomClient, showHome, code); }
const invite = new URLSearchParams(location.search).get('room');
if (/^\d{6}$/.test(invite || '') || platform.load('bluff-room')) showOnline(invite); else showHome();
