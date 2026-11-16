'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../server');
const { wechatVerifier } = require('../server/wechat');
const { Rooms } = require('../server/rooms');
test('WeChat verifier exchanges code on the official server and keeps session secrets private', async () => {
  const verify = wechatVerifier({ appId: 'test-app', secret: 'test-secret', request: async (url, options) => {
    assert.equal(url.origin, 'https://api.weixin.qq.com'); assert.equal(url.pathname, '/sns/jscode2session');
    assert.equal(url.searchParams.get('js_code'), 'login-code'); assert.equal(url.searchParams.get('appid'), 'test-app');
    assert.equal(url.searchParams.get('secret'), 'test-secret'); assert.equal(url.searchParams.get('grant_type'), 'authorization_code');
    assert(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ openid: 'actual-openid', session_key: 'never-return-this' }) };
  } });
  assert.equal(await verify('login-code'), 'test-app:actual-openid');
});
test('WeChat validation fails closed for missing config, bad codes, upstream errors and malformed replies', async () => {
  await assert.rejects(wechatVerifier({ appId: '', secret: '' })('code'), { status: 503 });
  const options = { appId: 'app', secret: 'secret' };
  await assert.rejects(wechatVerifier(options)('x'), { status: 401 });
  for (const value of [null, [], { errcode: 40029 }, {}, { openid: 12 }, { openid: 'x'.repeat(129) }]) {
    await assert.rejects(wechatVerifier({ ...options, request: async () => ({ ok: true, json: async () => value }) })('code'), { status: 401 });
  }
  await assert.rejects(wechatVerifier({ ...options, request: async () => { throw new Error('secret diagnostic'); } })('code'), e => e.status === 503 && !e.message.includes('secret'));
});
test('strict HTTP login rejects forged OpenID and recognizes a returning verified account on another device', async t => {
  const rooms = new Rooms(); let verifications = 0;
  const server = createServer({ rooms, requireWechat: true, verifyWechat: async code => {
    verifications++; assert.equal(code, 'server-verified-code'); return 'test-app:trusted-openid';
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (url, body, token) => {
    const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const fake = await post('/api/enter', { name: '冒名', requestId: 'forged-login-request', profileKey: 'forged-profile-key', openid: 'trusted-openid', subject: 'test-app:trusted-openid' });
  assert.equal(fake.status, 403); assert.equal(rooms.rooms.size, 0); assert.equal(verifications, 0);
  const first = await post('/api/enter', { name: '设备一', requestId: 'verified-device-one', profileKey: 'device-one-profile', loginCode: 'server-verified-code' });
  assert.equal(first.status, 200); assert.equal(first.data.state.identityKind, 'wechat');
  const identity = rooms.players.fromToken(first.data.profileToken); rooms.players.reserve([identity.id], ['term:王不留行']);
  await post(`/api/rooms/${first.data.code}/action`, { action: 'leave', opId: 'leaving-device-one' }, first.data.token);
  const second = await post('/api/enter', { name: '设备二', requestId: 'verified-device-two', profileKey: 'device-two-profile', loginCode: 'server-verified-code' });
  assert.equal(second.status, 200); assert.equal(second.data.profileToken, first.data.profileToken);
  assert.equal(second.data.state.freshCount, rooms.questions.length - 1); assert.equal(verifications, 2);
  for (const secret of ['trusted-openid', 'session_key', 'subject', 'registrationHash']) assert(!JSON.stringify(second.data).includes(secret));
});
