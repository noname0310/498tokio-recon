const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,firefox}=require('playwright');
const {makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
function fixture(){return {schemaVersion:1,presentation:{activeCamera:'camera'},root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6},{type:'GaussianBlur',sigmaWorld:{x:0,y:0}}],children:[
  {id:'marker',transform:{localPosition:{z:10}},components:[{type:'PlaneRenderer',size:{x:.04,y:.04}}]}
 ]},
 {id:'plain',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]}
]}};}
function moments(buffer){
 const p=png(buffer),samples=[];
 for(let y=130;y<230;y++)for(let x=270;x<370;x++){const w=p.pixels[(y*p.width+x)*p.channels];if(w)samples.push([x,y,w]);}
 const sum=samples.reduce((a,s)=>a+s[2],0),cx=samples.reduce((a,s)=>a+s[0]*s[2],0)/sum,cy=samples.reduce((a,s)=>a+s[1]*s[2],0)/sum;
 return [samples.reduce((a,s)=>a+(s[0]-cx)**2*s[2],0)/sum,samples.reduce((a,s)=>a+(s[1]-cy)**2*s[2],0)/sum];
}
async function settled(page){await page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
async function main(){
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer]of [['DOM',chromium,'dom'],['Firefox DOM',firefox,'dom'],['Babylon',chromium,'babylon']]){
  const browser=await type.launch(type===chromium?{headless:true,executablePath:chromium.executablePath()}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=2594`);await page.waitForFunction(()=>window.scenePlayer?.ready);await settled(page);
   await page.evaluate(data=>scenePlayer.loadScene(data),fixture());await settled(page);
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'}),sharp=await shot(),baseline=moments(sharp);
   for(const [x,y] of [[0,.035],[.025,.035],[.025,0],[0,0],[0,.035]]){
    await page.evaluate(({x,y})=>scenePlayer.setComponent('camera','GaussianBlur',{sigmaWorld:{x,y}}),{x,y});await settled(page);
    const image=await shot(),actual=moments(image);
    for(let axis=0;axis<2;axis++){
     const expected=baseline[axis]+([x,y][axis]*100)**2;
     assert(Math.abs(actual[axis]-expected)<2.1,`${name}: blur axis ${axis}: ${actual[axis]} vs ${expected}`);
    }
    if(!x&&!y)assert(compare(sharp,image).mae<.001,`${name}: zero blur restores the sharp render`);
   }
   await page.evaluate(()=>scenePlayer.setCamera('plain'));await settled(page);assert(compare(sharp,await shot()).mae<.001,`${name}: camera cut removes blur`);
   await page.evaluate(()=>scenePlayer.setCamera('camera'));await settled(page);assert(moments(await shot())[1]>10);
   if(renderer==='dom'){
    assert.equal(await page.locator('canvas').count(),0);
    const mutations=await page.evaluate(async()=>{let n=0;const observer=new MutationObserver(rows=>n+=rows.length);observer.observe(document.querySelector('.scene-world'),{attributes:true,childList:true,subtree:true});for(let i=0;i<4;i++)await scenePlayer.update();await Promise.resolve();observer.disconnect();return n;});
    assert.equal(mutations,0,'Unchanged blur reuses DOM nodes without mutations');
   }
   assert.deepEqual(errors,[]);console.log(`${name}: composed scene blur, both axes, bypass, camera cuts and reuse passed.`);
  }finally{await browser.close();}
 }}finally{server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
