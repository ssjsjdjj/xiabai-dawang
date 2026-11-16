'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const solo = require('../src/questions');
const online = require('../server/questions');

test('question banks fit answer limits and supply unique, sourced choices', () => {
  for (const [bank, count] of [[solo, 3], [online, 6]]) {
    for (const question of bank) {
      assert.equal(question.lies.length, count, question.term);
      const choices = [question.answer, ...question.lies];
      const normalized = choices.map(s => s.replace(/[\s，。！？、,.!?]/g, ''));
      assert.equal(new Set(normalized).size, choices.length, question.term);
      assert(choices.every(s => [...s].length > 0 && [...s].length <= 30), question.term);
      assert([...question.fact].length <= 76, question.term);
      assert(question.source.title && new URL(question.source.url).protocol === 'https:', question.term);
      assert.equal(question.tag, '怪名档案 · 真有其名');
    }
  }
});

test('public solo bank cannot reveal any of the online terms', () => {
  assert(solo.length >= 16 && online.length >= 512);
  const all = [...solo, ...online];
  assert(all.every(q => q.id === "term:" + q.term));
  assert.equal(new Set(all.map(q => q.id)).size, all.length);
  assert.equal(new Set(all.map(q => q.term)).size, all.length);
  assert.equal(new Set(all.map(q => q.q)).size, all.length);
  const publicContent = JSON.stringify(solo);
  for (const question of online) assert(!publicContent.includes(question.term), question.term);
  for (const term of ['王不留行', '阿月浑子']) assert(online.some(q => q.term === term));
});

test('expanded packs have varied topics and explicitly label ancient legends', () => {
  const result = require('../scripts/check-bank').validate();
  assert(result.domains >= 20);
  assert(online.filter(q => q.kind === 'myth').length >= 50);
  assert(online.filter(q => q.domain === 'plant').length / online.length < .25);
});
