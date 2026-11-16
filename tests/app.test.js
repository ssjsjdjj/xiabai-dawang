const {test}=require('node:test');
const assert=require('node:assert/strict');
const start=require('../src/app');
const Game=require('../src/engine');
const questions=require('../src/questions');
function harness(width=390,height=844){
 let tap,input,copy;const drawn=[];
 const context=new Proxy({measureText:s=>({width:[...s].length*12}),fillText:(...args)=>drawn.push(args)},{get:(obj,key)=>key in obj?obj[key]:()=>{}});
 const platform={canvas:{getContext:()=>context},size:()=>({width,height,dpr:2}),input:(value,cb)=>{input=cb;},closeInput:()=>{},onTap:fn=>{tap=fn;},onResize:()=>{},copy:(value,done)=>{copy=value;done();}};
 const interval=global.setInterval;global.setInterval=()=>0;let app;try{app=start(platform,Game,questions);}finally{global.setInterval=interval;}
 return {app,drawn,click:(x,y)=>tap(x,y),input:value=>input(value),copied:()=>copy};
}
test('canvas controls complete five rounds including text input, reveal and restart',()=>{
 const h=harness();h.click(100,675);assert.equal(h.app.game.phase,'write');
 for(let r=0;r<5;r++){
  h.click(100,370);h.input('这与一项失传的古老传统有关');h.click(100,680);assert.equal(h.app.game.phase,'vote');
  const i=h.app.game.options.findIndex(o=>o.id==='truth');h.click(100,340+i*78);assert.equal(h.app.game.phase,'reveal');
  h.click(100,762);assert.equal(h.app.game.revealStep,1);h.click(100,762);assert.equal(h.app.game.revealStep,2);h.click(100,762);
 }
 assert.equal(h.app.game.phase,'result');h.click(100,749);assert.match(h.copied(),/单人模拟试玩/);h.click(100,690);assert.equal(h.app.game.phase,'write');assert.equal(h.app.game.players[0].score,0);
 assert(h.drawn.every(([,x,y])=>Number.isFinite(x)&&Number.isFinite(y)));
});
test('touch coordinates scale to a narrow phone screen',()=>{const h=harness(320,640);const scale=640/844,offset=(320-390*scale)/2;h.click(offset+100*scale,675*scale);assert.equal(h.app.game.phase,'write');});
test('exhausted solo bank renders an exit instead of recycling a question',()=>{
 const h=harness();h.app.game.seen=new Set(questions.map(q=>q.id));h.click(100,675);
 assert.equal(h.app.game.phase,'exhausted');assert.equal(h.app.game.deck.length,0);
 assert(h.drawn.some(([text])=>text.includes('这批怪名，鉴定完了')));
 h.click(100,640);assert.equal(h.app.game.phase,'home');
});
