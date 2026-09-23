const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs');
const art={type:'Sprite',file:'/tests/fixtures/rect_sprite.png',size:{x:2,y:3},pixelsPerUnit:4,pivot:{x:.5,y:.5},filter:'point'};
const fixture={schemaVersion:1,timeline:{duration:10,autoplay:false},assets:{fast:art,slow:{...art,file:'/slow_atlas.png',atlas:{cellSize:{x:1,y:3},columns:2,rows:1,frameCount:2}},unused:{...art,file:'/future_image.png'}},root:{id:'loading-test',children:[
  {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
  {id:'fast',transform:{localPosition:{x:-1}},components:[{type:'SpriteRenderer',asset:'fast'}]},
  {id:'slow',transform:{localPosition:{x:1}},components:[{type:'SpriteRenderer',asset:'slow'}]}
]}};
async function main(){
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer] of [['chromium-dom',chromium,'dom'],['chromium-babylon',chromium,'babylon'],['firefox-dom',firefox,'dom']]){
  const browser=await type.launch({headless:true});let releaseSlow,releaseFuture;
  const slow=new Promise(r=>releaseSlow=r),future=new Promise(r=>releaseFuture=r),requested=new Set(),bytes=fs.readFileSync(path.join(root,'tests/fixtures/rect_sprite.png'));
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{const Original=Worker;window.workerStarts=0;window.Worker=class extends Original{constructor(...args){super(...args);window.workerStarts++;}};window.statusOverlaps=0;new MutationObserver(()=>{const startup=document.getElementById('status'),progress=document.querySelector('.runtime-loading-status');if(startup&&!startup.hidden&&progress&&!progress.hidden)window.statusOverlaps++;}).observe(document,{subtree:true,attributes:true,childList:true});});
   await page.addInitScript(()=>{const Original=OffscreenCanvas;window.preparationCanvases=0;window.OffscreenCanvas=class extends Original{constructor(...args){super(...args);window.preparationCanvases++;}};});
   await page.route('**/loading.scene.json',r=>r.fulfill({json:fixture}));
   for(const [file,gate]of [['slow_atlas.png',slow],['future_image.png',future]])await page.route(`**/${file}`,async route=>{requested.add(file);await gate;await route.fulfill({body:bytes,contentType:'image/png'});});
   await page.goto(`${base}/?scene=/loading.scene.json&renderer=${renderer}`);await page.waitForFunction(()=>window.scenePlayer?.ready);
   await page.waitForFunction(()=>document.querySelector('[data-state="active"][data-stage="Images"]')?.textContent==='Images 1 / 3 — slow_atlas.png');
   assert.deepEqual([...requested].sort(),['future_image.png','slow_atlas.png'],'Unused future images start immediately');
   assert(await page.evaluate(()=>scenePlayer.resources.isImageReady('fast')));assert.equal(await page.evaluate(()=>scenePlayer.resources.isImageReady('slow')),false);
   if(renderer==='dom'){await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-entity="fast"]')).display!=='none');assert.equal(await page.locator('[data-entity="slow"]').evaluate(e=>getComputedStyle(e).display),'none');}
   else assert.deepEqual(await page.evaluate(()=>['fast','slow'].map(id=>scenePlayer.renderer.objects.find(o=>o.id===id).meshes.get('SpriteRenderer').mesh.isEnabled())),[true,false]);
   await page.evaluate(()=>scenePlayer.play());await page.waitForFunction(()=>scenePlayer.time>.15);
   releaseSlow();await page.waitForFunction(()=>document.querySelector('[data-state="active"][data-stage="Images"]')?.textContent==='Images 2 / 3 — future_image.png');
   await page.waitForFunction(()=>scenePlayer.resources.isImageReady('slow'));
   releaseFuture();await page.evaluate(()=>scenePlayer.whenIdle());assert.equal(await page.locator('.runtime-loading-status').isVisible(),false);
   assert.equal(await page.evaluate(()=>scenePlayer.playing),true,'Finishing preparation must not stop playback');await page.evaluate(()=>scenePlayer.pause());
   const prepared=await page.evaluate(()=>window.preparationCanvases);assert(prepared>0);
   const playbackStart=await page.evaluate(()=>scenePlayer.time);await page.evaluate(()=>scenePlayer.play());await page.waitForFunction(start=>scenePlayer.time>start+.2,playbackStart);await page.evaluate(()=>scenePlayer.pause());
   assert.equal(await page.evaluate(()=>window.preparationCanvases),prepared,'Playback reuses prepared images');
   const check=await page.evaluate(async()=>{
    const {TextureProcessor,generateTexture}=await import('/runtime/player.js'),before=window.workerStarts,processor=new TextureProcessor();
    const inputs=[1,99,411].map(seed=>({kind:'noise',component:{seed,textureSize:{x:8,y:12},range:.4,bands:[{sigmaTexels:{x:.7,y:1.3},variance:.01}]}}));
    const output=await Promise.all(inputs.map(input=>processor.run(input)));
    const exact=output.every((im,i)=>im.data.every((v,k)=>v===generateTexture(inputs[i]).data[k]));
    let rejected=false;try{await processor.run({kind:'unknown'});}catch{rejected=true;}
    const again=await processor.run(inputs[0]);const reused=window.workerStarts-before;processor.dispose();
    let disposed=false;try{await processor.run(inputs[0]);}catch{disposed=true;}
    const progress=scenePlayer.loadingProgress;const old=progress.begin('Shaders','old');progress.reset();const finish=progress.begin('Shaders','sprite.frag');old();
    const beforeFinish=document.querySelector('[data-state="active"][data-stage="Shaders"]').textContent;finish();finish();progress.complete();
    const retained=!document.querySelector('.runtime-loading-status').hidden,success=document.querySelector('[data-state="finished"]').textContent.includes('Successfully');
    await scenePlayer.play();scenePlayer.pause();const hidden=document.querySelector('.runtime-loading-status').hidden;
    scenePlayer.dispose();return {exact,rejected,disposed,reused,again:again.data[0]===output[0].data[0],beforeFinish,retained,success,hidden,removed:!document.querySelector('.runtime-loading-status')};
   });
   assert.deepEqual(check,{exact:true,rejected:true,disposed:true,reused:1,again:true,beforeFinish:'Shaders 0 / 1 — sprite.frag',retained:true,success:true,hidden:true,removed:true});assert.deepEqual(errors,[]);
   assert.equal(await page.evaluate(()=>window.statusOverlaps),0,'Startup and runtime status must never overlap');
   console.log(`${name}: eager loading, filenames, nonblocking playback, single status, extensible progress and persistent worker passed.`);
  }finally{releaseSlow();releaseFuture();await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
