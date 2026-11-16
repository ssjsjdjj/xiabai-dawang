'use strict';
// ID 一经发布就永久保留。新增独立题包，不改旧 ID、不轮换旧题。
// 所有题包仅供服务端加载，禁止复制进客户端静态资源。
module.exports = [
  ...require('./packs/original-64.json'),
  ...require('./packs/rare-2026-10.json')
];
