const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{compare,png}=require('./pixel-check.cjs');
async function main(){
 const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),scene=new Scene(data,pathToFileURL(file).href);
 const at=f=>{scene.setFrameTime(Time.fromDecimal(f),frameRate(30));scene.updateWorld();};
 const point=id=>{const m=scene.world.get(id);return [320+m[12]*100,180-m[13]*100];};
 for(const f of [4861.999,4862,4940.999,4941,5235.999,5236,5522.999,5523,5541.999,5542].reverse()){
  at(f);assert.equal(scene.nodes.has('memory-world'),f>=4941&&f<5542);assert.equal(scene.nodes.has('memory-echo-stage'),f>=4862&&f<4941);
  if(f>=4941&&f<5542){assert.equal(scene.cameraNode.id,f<5532?'helmet-flat-camera':'storm-camera');assert.deepEqual([...scene.world.get(scene.cameraNode.id)],[1,0,0,0,0,1,0,0,0,0,1,0,0,0,-10,1]);}
 }
 for(const [f,opacity]of [[4941,.2],[4949.999,.2],[4950,.4],[4958.999,.4],[4959,.6],[4969,.8],[4978,1]]){
  at(f);assert.equal(scene.requireComponent('memory-fade','Transition').progress,Math.fround(opacity));
 }
 at(4941);assert(Math.abs(point('memory-falling-paper')[0]-651.7673)<.01);
 at(4959);assert(Math.abs(point('memory-falling-paper')[0]-524.0464)<.1);
 // The cycle reference was measured after entry. Its phase must also run
 // through the fade-in, including the earlier reuse behind the helmet.
 for(const [f,pose]of [[4941,3],[4942,0],[4944,0],[4945,1],[4948,2],[4951,3],[4977,3],[4978,0]]){
  for(const [offset,prefix]of [[0,'memory-ground'],[-79,'memory-echo-ground']]){
   at(f+offset);
   for(const child of ['a','b'])assert.equal(scene.spriteState(`${prefix}-child-${child}-body`).frame,pose,`Entry running pose at ${f+offset}`);
  }
 }
 at(5023);assert(Math.abs(point('memory-ground-child-a')[0]-293.748674)<.001);assert(Math.abs(point('memory-ground-child-b')[0]-326)<.001);
 for(const [f,pose]of [[5023,4],[5043,5],[5088,5]]){at(f);assert.equal(scene.spriteState('memory-ground-child-a-body').frame,pose);}
 at(5089);assert(!scene.isActive('memory-falling-paper'));assert(scene.isActive('memory-ground-carried-paper'));
 at(5236);assert(!scene.isActive('memory-ground'));assert(scene.isActive('memory-cliff-shot'));
 for(const f of [5331,5334,5337]){
  at(f);const first=point('memory-cliff-child-a')[1];at(f+13);assert(Math.abs(first-point('memory-cliff-child-a')[1])<.0001,'Both jumps share the same fitted curve');
 }
 at(5334);assert(Math.abs(point('memory-cliff-child-a')[1]-113.305)<.01);
 at(5411);const bottom=point('memory-cliff-child-a')[1];at(5427);assert(Math.abs(bottom-point('memory-cliff-child-a')[1]-26)<.001);
 for(const f of [4983,5020,5200,5365]){at(f);const first=structuredClone(scene.requireComponent('memory-moon','SpriteRenderer'));at(f+108);assert.deepEqual(scene.requireComponent('memory-moon','SpriteRenderer'),first,'Moon palette loops without trimming its first partial cycle');}
 at(5513);assert(scene.isActive('memory-cliff-carried-paper'));at(5514);assert(!scene.isActive('memory-cliff-carried-paper'));assert(scene.isActive('memory-launched-paper'));assert.equal(scene.spriteState('memory-cliff-child-a-body').frame,6);
 at(5523);assert(!scene.isActive('memory-moon'));assert(!scene.isActive('memory-cliff-shot'));assert(scene.isActive('memory-closeup-moon'));
 for(const [f,x]of [[5523,470.453],[5524,406.778],[5525,365.711],[5526,337.274],[5527,317.290],[5528,303.560],[5529,294.766],[5530,290.032],[5531,288.485]]){
  at(f);assert(Math.abs(point('memory-closeup-paper')[0]-x)<.1,`Two-key paper deceleration at ${f}`);
 }
 at(5541);assert.equal(scene.requireComponent('memory-fade','Transition').progress,0);
 assert.equal(scene.requireComponent('helmet-flat-camera','GaussianBlur').enabled,false,'Outgoing blur never filters the incoming storm');
 at(5535);assert(scene.requireComponent('memory-fade','GaussianBlur').sigmaWorld.x>.2);
 const chapter=data.animation.sequences['childhood-memory'];for(const b of chapter.bindings)if(b.property.component==='Transform')assert(data.animation.tracks[b.track].frameNumber.length<=10,'Motion keys describe curves, not dense measured frames');
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,captures={};
 try{for(const [label,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true});try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden');};});
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=5325`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=f=>page.evaluate(async f=>{await scenePlayer.seekFrame(f,{numerator:30,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},f);
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   const state=()=>page.evaluate(()=>JSON.stringify([...scenePlayer.scene.nodes].map(([id,n])=>[id,n.components,scenePlayer.scene.world.get(id)])));
   await seek(5325);const initial=await state(),first=await shot();captures[label]=first;
   for(const f of [5542,5526,4870,4941,5023,5043,5089,5236,5331,5420,5471,5514,5533,5325])await seek(f);
   assert.equal(await state(),initial,`${label}: reverse seeking restores all scene state`);assert(compare(first,await shot()).mae<.06,`${label}: stable re-entry`);
   await seek(5541);assert.equal(await page.evaluate(()=>scenePlayer.scene.requireComponent('memory-fade','Transition').progress),0,`${label}: outgoing memory finishes its fade independently of the next chapter`);
   for(const viewport of [{width:390,height:844},{width:2560,height:540}]){
    await page.setViewportSize(viewport);await seek(5480);const image=png(await shot());
    for(const [x,y]of [[2,5],[viewport.width-3,5]]){const i=(y*image.width+x)*image.channels;assert(image.pixels[i+2]>0,`${label}: sky covers expanded aspect`);}
    const sample=(Math.floor(viewport.height*.9)*image.width+viewport.width-3)*image.channels;
    if(viewport.width>viewport.height*2)assert(image.pixels.subarray(sample,sample+3).every(v=>v<3),`${label}: right cliff extension ends in black`);
    assert.equal(await page.evaluate(()=>scenePlayer.scene.cameraNode.id),'helmet-flat-camera');
    await seek(5526);
   }
   if(renderer==='dom')assert.equal(await page.locator('canvas').count(),0);assert.deepEqual(errors,[]);console.log(`${label}: fixed camera, recollection, moon close-up, extended cliff and rewind passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
 const parity=compare(captures.dom,captures.babylon);assert(parity.mae<3,`Memory backend agreement: ${JSON.stringify(parity)}`);console.log('Memory renderer mean RGB difference:',parity.mae);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
