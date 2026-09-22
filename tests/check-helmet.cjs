const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{compare,png}=require('./pixel-check.cjs');
const file='assets/final_animation.scene.json',data=JSON.parse(fs.readFileSync(path.join(root,file),'utf8')),out=path.join(root,'test-results/helmet_motion');
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),scene=new Scene(data,pathToFileURL(path.join(root,file)).href),rate=frameRate(30);
 const at=n=>{scene.setFrameTime(Time.fromDecimal(n),rate);scene.updateWorld();};
 const future=[...scene.nodes.keys()].filter(id=>id.startsWith('helmet-'));
 for(const n of [0,1735,2083,2098,2100]){at(n);for(const id of future)assert(!scene.active.get(id),`${id} leaked into frame ${n}`);}
 for(const id of ['helmet-falling','helmet-worn','helmet-closeup'])assert.equal(scene.requireComponent(id,'SpriteRenderer').asset,'helmet_helmet_blue');
 assert(!('helmet_helmet_blue_closeup' in data.assets));
 assert(data.animation.tracks['helmet-horizontal-band-phase'].value[1]<0,'Noise must travel downward in the Y-up scene');
 for(let i=0;i<12;i++){
  const c=scene.requireComponent(`helmet-bar-${i}`,'TiledSpriteRenderer'),asset=scene.asset(c.asset);
  assert.equal(c.clipBounds.right*asset.pixelsPerUnit/4,[3,4,4][i%3],'LED columns follow 4 / 4 / 3, preceded by the partial 3-column bar');
 }
 for(let n=2101;n<=2256;n++){
  at(n);assert.equal(scene.cameraNode.id,n<2196?'interior-camera':n<2208?'helmet-bars-camera':'helmet-flat-camera');
  if(n>=2196)assert(!scene.component(scene.cameraNode.id,'Vignette')?.enabled,'Vignette must end with the room');
  for(const matrix of scene.world.values())assert(matrix.every(Number.isFinite));
 }
 const sampled={};
 for(const fps of [30,60,120]){
  const values=new Set();for(let i=0;i<=8*fps/30;i++){at(2208+i*30/fps);values.add(Math.round(scene.component('helmet-percentages','SpriteNumberRenderer').value));}sampled[fps]=[...values];
 }
 assert.deepEqual(sampled[30],[74,77,81,84,87,90,94,97,100]);assert(sampled[60].includes(76)&&sampled[60].length>sampled[30].length);assert.deepEqual(sampled[120],Array.from({length:27},(_,i)=>74+i));
 const numberTrack=data.animation.tracks['helmet-percentage-value'];assert.equal(numberTrack.type,'AnimationTrackFloat32');assert.equal(numberTrack.frameNumber.length,2);
 at(2255);assert(scene.active.get('helmet-launch-warp-0'));at(2256);assert(!scene.active.get('helmet-launch-warp-0'));
 assert(!scene.nodes.has('helmet-vertical-warp'),'Teleport afterimage uses the actual sprite, not a replacement line');
 at(2180);assert(scene.component('helmet-worn','SpriteMotionBlur').dilationPixels>0);
 at(2181);assert(scene.active.get('helmet-worn'));assert(scene.transformAt('helmet-worn').localScale.y>100);
 at(2182);assert(!scene.active.get('helmet-worn'));assert(!scene.active.get('interior-final-person'));
 at(2224);assert(!scene.component('helmet-closeup','SpriteMotionBlur')?.enabled,'The source helmet is sharp through 2224');
 at(2225);const motion=scene.component('helmet-face','SpriteMotionBlur'),pose=scene.transformAt('helmet-face');
 const effects={radial:{centerPixels:[318.3450903049162,183.94047576477388]}};
 assert(Math.abs(320+100*(pose.localPosition.x+motion.center.x*pose.localScale.x)-effects.radial.centerPixels[0])<.001);
 assert(Math.abs(180-100*(pose.localPosition.y+motion.center.y*pose.localScale.y)-effects.radial.centerPixels[1])<.001,'Zoom blur converges near the aperture centre, independent of the sprite foot pivot');
 at(2100);for(const id of future)assert(!scene.active.get(id),`${id} survived a reverse seek before its sequence`);
 for(const n of [2216,2208.25,2235,2196,2152,2119,2100]){at(n);if(n<2196)assert.equal(scene.cameraNode.id,'interior-camera');if(n>=2112&&n<2143)assert.equal(scene.component('helmet-falling','SpriteRenderer').color.a,n%2?1:.5);}
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,report={sampled,renderers:{}};
 try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['babylon',chromium,'babylon'],['firefox',firefox,'dom']]){
  const browser=await type.launch(type===chromium?{executablePath:[chromium.executablePath()].find(fs.existsSync)}:{});
  try{const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden in DOM');};});
   await page.goto(`${base}/index.html?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
   const seek=async n=>{await page.evaluate(async n=>{const {Time,frameRate}=await import('/runtime/player.js');await scenePlayer.seekFrame(Time.fromDecimal(n),frameRate(30));await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},n);};
   for(const n of [2119,2157,2179,2180,2181,2182,2189,2190,2192,2194,2196,2200,2207,2208,2208.25,2216,2217,2224,2225,2226,2232,2235,2236,2238,2244,2245,2248,2255,2256,2100]){await seek(n);await page.screenshot({path:path.join(out,`${name}_${String(n).replace('.','_')}.png`)});}
   if(renderer==='dom')assert.equal(await page.locator('[data-entity^="helmet-"]').evaluateAll(nodes=>nodes.filter(n=>getComputedStyle(n).display!=='none').length),0,'Future chapter surfaces remain hidden on reverse seek');
   if(renderer==='dom')assert.equal(await page.locator('canvas').count(),0);
   for(const n of [2224.999,2225,2235.999,2236,2244.999,2245,2236,2225,2224]){
    await seek(n);
    const state=await page.evaluate(()=>['helmet-closeup','helmet-face','helmet-launch-hull','helmet-launch-warp-0'].map(id=>scenePlayer.scene.active.get(id)));
    assert.deepEqual(state,[n<2225,n>=2225&&n<2235,n>=2236&&n<2245,n>=2245],'Appearance boundaries survive forward and reverse seeks');
   }
   await seek(2208);const first=await page.screenshot();await seek(2216);await seek(2208);assert.equal(compare(first,await page.screenshot()).max,0,'Shrinking the digit count reuses and hides surplus slots');
   await seek(2208.25);if(renderer==='dom')assert.equal(await page.locator('[data-entity="helmet-percentages"]').getAttribute('data-text'),'75%');
   if(renderer==='dom'){
    const stable=await page.evaluate(async()=>{
     const {Time,frameRate}=await import('/runtime/player.js'),element=document.querySelector('[data-entity="helmet-percentages"]'),images=[...element.querySelectorAll('image')];let writes=0;
     const observer=new MutationObserver(list=>writes+=list.length);observer.observe(element,{subtree:true,attributes:true,childList:true});
     scenePlayer.scene.setFrameTime(Time.fromDecimal(2208.26),frameRate(30));await scenePlayer.update(false);await new Promise(r=>requestAnimationFrame(r));observer.disconnect();
     return {writes,reused:images.every((im,i)=>element.querySelectorAll('image')[i]===im)};
    });assert(stable.reused);assert.equal(stable.writes,0,'Fractional values within one displayed integer do not mutate the numeric DOM');
    await seek(2226);assert.equal(await page.locator('[data-entity="helmet-face"] img').count(),33);const transform=await page.locator('[data-entity="helmet-face"] img').nth(1).evaluate(e=>getComputedStyle(e).transform);assert.notEqual(transform,'none');
   }
   for(const size of [{width:390,height:844},{width:1280,height:320}]){
    await page.setViewportSize(size);for(const n of [2196,2207,2208.25,2226,2255]){await seek(n);await page.screenshot({path:path.join(out,`${name}_${String(n).replace('.','_')}_${size.width}.png`)});}
   }
   await page.setViewportSize({width:640,height:360});
   const filtered={schemaVersion:1,assets:{art:{...data.assets.helmet_pilot_front,file:'/assets/landing/pilot_front.png'}},root:{id:'root',children:[
    {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
    {id:'art',transform:pose,components:[{type:'SpriteRenderer',asset:'art',color:{r:1,g:1,b:1,a:.2}},{type:'SpriteMotionBlur',...motion,dilationPixels:.3,softnessPixels:.2,alphaGain:20}]}
   ]}};
   await page.evaluate(async data=>{await scenePlayer.loadScene(data);await scenePlayer.whenIdle();},filtered);
   const faded=png(await page.screenshot()),peak=faded.pixels.reduce((v,n,i)=>i%faded.channels<3?Math.max(v,n):v,0);
   assert(peak>=45&&peak<=53,'Sprite opacity stays outside the saturating convolution alpha gain');
   const reuse=await page.evaluate(async()=>{
    const object=scenePlayer.renderer.objects.find(o=>o.id==='art'),images=[...document.querySelectorAll('[data-entity="art"] img')],texture=object.filter?.texture,passes=object.filter?.renderCount;
    await scenePlayer.setComponent('art','SpriteMotionBlur',{radialAmount:.2,alphaGain:3});await scenePlayer.whenIdle();
    const after=scenePlayer.renderer.objects.find(o=>o.id==='art');
    return {object:after===object,images:images.every((e,i)=>document.querySelectorAll('[data-entity="art"] img')[i]===e),texture:after.filter?.texture===texture,passes:after.filter?.renderCount===passes};
   });assert(Object.values(reuse).every(Boolean),'Motion and gain edits reuse sprite DOM/GPU filter resources');
   assert.deepEqual(errors,[]);report.renderers[name]={errors:[],captures:true};console.log(`${name}: camera cuts, native sprites, 75% subframe, reverse seeks, retained DOM, portrait/wide and Canvas prohibition passed.`);
  }finally{await browser.close();}
 }}finally{server.close();}
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`Numeric displays: 30Hz=${sampled[30].length}, 60Hz=${sampled[60].length}, 120Hz=${sampled[120].length} distinct values, using two keys.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
