const assert=require('node:assert/strict'),{chromium,firefox}=require('playwright');
const {makeServer}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const fixture={schemaVersion:1,root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6},{type:'Vignette',quadratic:.3,quartic:.8,color:{r:.1,g:.3,b:.8,a:.6}}]},
 {id:'background',transform:{localPosition:{z:2}},components:[{type:'PlaneRenderer',coverage:'camera',color:{r:.6,g:.5,b:.4,a:1}}]},
 {id:'circle',components:[{type:'PlaneRenderer',enabled:false,shape:'ellipse',size:{x:2,y:2},edgeSoftness:.15,color:{r:1,g:1,b:1,a:1}}]}
]}};
async function main(){const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,shots={};
 try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['firefox',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true});try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());await page.evaluate(d=>scenePlayer.loadScene(d),fixture);
   const settle=()=>page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   await settle();const colored=await shot();shots[name]=colored;
   const pixel=(bytes,x,y)=>{const im=png(bytes),i=(y*im.width+x)*im.channels;return [...im.pixels.subarray(i,i+3)];};
   const x=40,y=30,r2=((x+.5-320)/320)**2+((y+.5-180)/180)**2,alpha=.6*(1-Math.exp(-.3*r2-.8*r2*r2));
   const expected=[.6,.5,.4].map((v,i)=>255*(v*(1-alpha)+[.1,.3,.8][i]*alpha));
   assert(pixel(colored,x,y).every((v,i)=>Math.abs(v-expected[i])<3),`${name}: analytic colored vignette`);
   await page.evaluate(()=>scenePlayer.setComponent('camera','Vignette',{depth:11}));await settle();assert(compare(colored,await shot()).mae<.8,`${name}: depth plane and screen-space vignette agree`);
   await page.evaluate(()=>scenePlayer.setComponent('camera','Vignette',{blend:'multiply'}));await settle();const multiplied=await shot();
   const multiplyExpected=[.6,.5,.4].map((v,i)=>255*v*(1-alpha+[.1,.3,.8][i]*alpha));
   assert(pixel(multiplied,x,y).every((v,i)=>Math.abs(v-multiplyExpected[i])<3),`${name}: multiply vignette attenuates the background without adding its tint`);
   await page.evaluate(()=>scenePlayer.setComponent('camera','Vignette',{depth:null}));await settle();assert(compare(multiplied,await shot()).mae<.8,`${name}: multiply plane and post effect agree`);
   await page.evaluate(()=>scenePlayer.setComponent('camera','Vignette',{blend:'normal'}));await settle();assert(compare(colored,await shot()).mae<.8,`${name}: blend mode restores after seeking`);
   await page.evaluate(()=>{scenePlayer.setComponent('camera','Vignette',{enabled:false});scenePlayer.setComponent('background','PlaneRenderer',{color:{r:0,g:0,b:0,a:1}});scenePlayer.setComponent('circle','PlaneRenderer',{enabled:true});});await settle();
   const soft=await shot();assert(pixel(soft,320,180).every(v=>v>252));assert(pixel(soft,419,180).every(v=>v>125&&v<145),`${name}: smooth edge midpoint`);assert(pixel(soft,436,180).every(v=>v<2));
   await page.evaluate(()=>scenePlayer.setComponent('circle','PlaneRenderer',{edgeSoftness:0}));await settle();assert(pixel(await shot(),419,180).every(v=>v>235),`${name}: restore sharp ellipse`);
   await page.evaluate(()=>scenePlayer.setComponent('circle','PlaneRenderer',{edgeSoftness:.15,innerRadiusRatio:.6}));await settle();assert(pixel(await shot(),320,180).every(v=>v<2),`${name}: soft ring preserves hole`);
   assert.deepEqual(errors,[]);console.log(`${name}: colored/depth vignette and smooth procedural ellipse passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
 assert(compare(shots.dom,shots.babylon).mae<.8);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
