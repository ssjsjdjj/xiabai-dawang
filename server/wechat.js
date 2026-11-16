'use strict';
const { IdentityError } = require('./players');
function wechatVerifier({ appId = process.env.WX_APPID, secret = process.env.WX_APPSECRET, request = fetch } = {}) {
  return async code => {
    if (!appId || !secret) throw new IdentityError('服务尚未配置微信登录，请联系房主。', 503);
    if (typeof code !== 'string' || code.length < 4 || code.length > 256) throw new IdentityError('微信登录凭证无效，请重新登录。', 401);
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({ appid: appId, secret, js_code: code, grant_type: 'authorization_code' }).toString();
    let data;
    try {
      const response = await request(url, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error('upstream');
      data = await response.json();
    } catch { throw new IdentityError('暂时无法验证微信身份，请稍后重试。', 503); }
    if (!data || typeof data !== 'object' || data.errcode || typeof data.openid !== 'string' || !data.openid || data.openid.length > 128) throw new IdentityError('微信登录已过期，请重新登录。', 401);
    // session_key、AppSecret、OpenID 从不发给客户端，也不写日志。
    return appId + ':' + data.openid;
  };
}
module.exports = { wechatVerifier };
