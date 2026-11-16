'use strict';
const assert = require('node:assert/strict');
const online = require('../server/questions');
const solo = require('../src/questions');
const normalize = s => s.normalize('NFKC').replace(/[\s，。！？、,.!?]/g, '').toLowerCase();
function validate() {
  const ids = new Set(), terms = new Set(), prompts = new Set();
  for (const [bank, count] of [[online, 6], [solo, 3]]) {
    for (const q of bank) {
      assert.equal(q.id, 'term:' + q.term, q.term);
      assert(!ids.has(q.id) && !terms.has(q.term) && !prompts.has(q.q), '重复题：' + q.term);
      ids.add(q.id); terms.add(q.term); prompts.add(q.q);
      assert.equal(q.lies.length, count, q.term);
      const choices = [q.answer, ...q.lies];
      assert(choices.every(s => typeof s === 'string' && [...s].length > 0 && [...s].length <= 30), '答案长度：' + q.term);
      assert.equal(new Set(choices.map(normalize)).size, count + 1, '选项重复：' + q.term);
      assert(q.q && [...q.q].length <= 48, '题面长度：' + q.term);
      assert(q.fact && [...q.fact].length <= 76, '解读长度：' + q.term);
      assert(q.source.title && new URL(q.source.url).protocol === 'https:', '缺少出处：' + q.term);
      assert.equal(q.tag, '怪名档案 · 真有其名');
      if (bank === online) assert(q.domain, '缺少内部题材：' + q.term);
      if (q.kind === 'myth') assert(q.q.includes('《山海经》') && q.fact.startsWith('古书传说：'), '传说须标明语境：' + q.term);
    }
  }
  return { online: online.length, solo: solo.length, domains: new Set(online.map(q => q.domain)).size };
}
if (require.main === module) {
  const result = validate();
  console.log(`题库检查通过：联机 ${result.online} 道，单人 ${result.solo} 道，联机 ${result.domains} 种内部题材。`);
}
module.exports = { validate };
