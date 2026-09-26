const assert=require('node:assert/strict'),{chromium,firefox}=require('playwright'),{makeServer}=require('./serve.cjs'),{compare}=require('./pixel-check.cjs');
async function main(){
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer]of [['Chromium DOM',chromium,'dom'],['Firefox DOM',firefox,'dom'],['Chromium Babylon',chromium,'babylon'],['Firefox Babylon',firefox,'babylon']]){
  const browser=await type.launch();try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   await page.evaluate(async()=>{await scenePlayer.seekFrame(5586);await scenePlayer.whenIdle();});
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'}),before=await shot();
   const batch=await page.evaluate(async()=>{
    const p=scenePlayer;const requests=[5538,6098,6450,5586].map(f=>p.seekFrame(f));
    return Promise.race([Promise.all(requests).then(()=>true),new Promise(r=>setTimeout(()=>r(false),5000))]);
   });
   assert(batch,`${name}: all rapid seek requests must settle`);
   await page.evaluate(()=>scenePlayer.whenIdle());const after=await shot();assert(compare(before,after).mae<.12,`${name}: tiled cloud geometry and effects restore after rapid cross-scene seeks`);
   await page.evaluate(()=>scenePlayer.play());await page.waitForFunction(()=>scenePlayer.time>5586/30+.3,null,{timeout:5000});
   const running=await page.evaluate(()=>({time:scenePlayer.time,audio:scenePlayer.audioPlayer.element.currentTime,updates:scenePlayer.renderer.updateRevision}));
   assert(Math.abs(running.time-running.audio)<.2,`${name}: audio and animation advance together`);
   await page.waitForFunction(updates=>scenePlayer.renderer.updateRevision>updates+2,running.updates);await page.evaluate(()=>scenePlayer.pause());
   assert(compare(after,await shot()).mae>1,`${name}: playback changes the rendered image, including its tiled layers`);
   assert.deepEqual(errors,[]);console.log(`${name}: coalesced seeks settle, tiled layers restore, playback advances.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
