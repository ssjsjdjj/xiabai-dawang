const {test}=require('node:test');
const assert=require('node:assert/strict');
const Game=require('../src/engine');
const questions=require('../src/questions');
function setup(){const g=new Game(questions,()=>.37);g.next();return g;}
test('reject empty, overly long and duplicate answers',()=>{const g=setup();assert.equal(g.submit('  '),false);assert.equal(g.submit('字'.repeat(31)),false);assert.equal(g.submit(g.question.answer),false);assert.equal(g.phase,'write');assert.equal(g.submit('专门用来判断天气的一种方法'),true);});
test('self-voting forbidden; scoring equals actual votes and cannot be applied twice',()=>{const g=setup();g.submit('一种古老的秘密仪式');assert.equal(g.vote('self'),false);assert.equal(g.vote('missing'),false);assert.equal(g.vote('truth'),true);const expected=[0,0,0,0];for(const v of g.votes){const o=g.options.find(o=>o.id===v.id);assert.notEqual(o.owner,v.player);if(o.id==='truth')expected[v.player]+=2;else expected[o.owner]++;}assert.deepEqual(g.players.map(p=>p.score),expected);assert.equal(g.players[0].hits,1);assert.equal(g.vote('truth'),false);assert.deepEqual(g.players.map(p=>p.score),expected);});
test('timeout fills answer and skips vote; fallback earns no deception score',()=>{const g=setup();assert.equal(g.tick(g.deadline),true);assert.equal(g.phase,'vote');assert.equal(g.fallback,true);g.options=[g.options.find(o=>o.id==='self'),...g.options.filter(o=>o.id!=='self')];g.random=()=>0;g.tick(g.deadline);assert.equal(g.phase,'reveal');assert.equal(g.selected,null);assert.equal(g.players[0].score,0);assert.equal(g.players[0].fooled,0);});
test('five distinct rounds finish, record history and restart cleanly',()=>{const g=new Game(questions);for(let i=0;i<5;i++){g.next();g.submit('与一项已经失传的传统有关');g.vote('truth');}g.next();assert.equal(g.phase,'result');assert.equal(g.history.length,5);assert.equal(new Set(g.deck.map(q=>q.q)).size,5);g.reset();assert.equal(g.phase,'home');assert.equal(g.round,-1);assert.equal(g.history.length,0);assert.equal(g.players[0].score,0);});
test('next cannot skip an unfinished round',()=>{const g=setup();g.next();assert.equal(g.round,0);g.prepare(null);g.next();assert.equal(g.round,0);});
test('solo history survives reload, reserves full matches and stops when exhausted',()=>{
  let saved=[];const progress={load:()=>saved,save:ids=>{saved=ids;}};
  const bank=questions.slice(0,6),one=new Game(bank,()=>.37,progress);one.next();
  const first=one.deck.map(q=>q.id);assert.equal(saved.length,5);
  const two=new Game(bank,()=>.37,progress);two.next();assert.equal(two.deck.length,1);assert(!first.includes(two.question.id));assert.equal(saved.length,6);
  two.reset();two.next();assert.equal(two.phase,'exhausted');assert.equal(two.deck.length,0);
  const updated=new Game([...bank.map(q=>({...q,q:q.q+'修订'})),questions[6]],()=>.37,progress);updated.next();assert.equal(updated.deck.length,1);assert.equal(updated.question.id,questions[6].id);
});
