const startGame = require('./src/app');
const Game = require('./src/engine');
const questions = require('./src/questions');
const RoomClient = require('./src/client');
const startRoomUI = require('./src/room-ui');
const config = require('./config');
const canvas = wx.createCanvas();
let callback = null, tap = () => {}, resize = () => {}, current;
wx.onKeyboardInput(res => { if (callback) callback(res.value); });
wx.onKeyboardConfirm(res => { if (callback) callback(res.value); wx.hideKeyboard(); });
wx.onTouchEnd(e => { const t = e.changedTouches[0]; if (t) tap(t.clientX, t.clientY); });
wx.onWindowResize(() => resize());
const platform = {
  canvas, serverBase: config.serverBase,
  size() { const i = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); return { width: i.windowWidth, height: i.windowHeight, dpr: i.pixelRatio || 1, safeTop: i.safeArea?.top || 0, safeBottom: i.safeArea ? Math.max(0, i.windowHeight - i.safeArea.bottom) : 0 }; },
  input(value, onChange, options = {}) { callback = onChange; wx.showKeyboard({ defaultValue: value, maxLength: options.maxLength || 30, multiple: false, confirmHold: false, confirmType: 'done' }); },
  closeInput() { callback = null; wx.hideKeyboard(); },
  onTap(fn) { tap = fn; }, onResize(fn) { resize = fn; },
  copy(text, done) { wx.setClipboardData({ data: text, success: done }); },
  load(key) { try { return wx.getStorageSync(key) || null; } catch { return null; } },
  save(key, value) { try { if (value === null) wx.removeStorageSync(key); else wx.setStorageSync(key, value); } catch {} },
  request(url, method, data, token) {
    return new Promise((resolve, reject) => wx.request({ url, method, data, timeout: 8000,
      header: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      success(res) { if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data); else { const e = new Error(res.data?.error || '请求失败'); e.status = res.statusCode; reject(e); } },
      fail() { reject(new Error('连不上房间服务，请检查地址和网络。')); }
    }));
  },
  shareRoom(code) { wx.shareAppMessage({ title: '来《瞎掰大王》一起瞎编！房间 ' + code, query: 'room=' + code }); },
  loginCode: config.useWechatLogin ? () => new Promise((resolve, reject) => wx.login({
    success: res => res.code ? resolve(res.code) : reject(new Error('微信登录失败，请重试。')),
    fail: () => reject(new Error('微信登录失败，请检查网络。'))
  })) : undefined,
  openOnline() { showOnline(); }
};
function showHome() { current?.destroy(); current = startGame(platform, Game, questions); }
function showOnline(code) { current?.destroy(); current = startRoomUI(platform, RoomClient, showHome, code); }
wx.showShareMenu({ menus: ['shareAppMessage'] });
wx.onShareAppMessage(() => {
  const code = current?.client?.session?.code;
  return { title: '一本正经，胡说八道。来玩《瞎掰大王》！', query: code ? 'room=' + code : '' };
});
const launch = wx.getLaunchOptionsSync?.() || {};
if (/^\d{6}$/.test(launch.query?.room || '')) showOnline(launch.query.room);
else if (platform.load('bluff-room')) showOnline();
else showHome();
wx.onHide(() => { current?.client?.pause(); });
wx.onShow(options => {
  current?.client?.wake();
  const code = options.query?.room;
  if (!/^\d{6}$/.test(code || '')) return;
  const currentCode = current?.client?.session?.code;
  if (currentCode && currentCode !== code) wx.showToast({ title: '请先退出当前房间', icon: 'none' });
  else if (!currentCode) showOnline(code);
});
