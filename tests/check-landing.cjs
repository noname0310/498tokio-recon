const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{compare,png}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),scene=new Scene(data,pathToFileURL(file).href);
 const at=n=>{scene.setFrameTime(Time.fromDecimal(n),frameRate(30));scene.updateWorld();};
 const point=id=>{const m=scene.world.get(id),c=scene.world.get(scene.cameraNode.id),p=scene.projectCameraPoint({x:m[12]-c[12],y:m[13]-c[13],z:m[14]-c[14]});return {x:320+p.x*100,y:180-p.y*100};};
 for(const n of [4529.999,4530,4533,4536,4788,4789,4863,4872,4940.999,4941].reverse()){
  at(n);assert.equal(scene.nodes.has('landing-world'),n>=4530&&n<4941);assert.equal(scene.cameraNode.id==='landing-camera',n>=4530&&n<4941);
 }
 at(4533);assert.equal(scene.requireComponent('landing-entry-fade','Transition').progress,Math.fround(.6));
 assert.equal(scene.requireComponent('biome-cloud-2-lower','TiledSpriteRenderer').color.a,1,'Outgoing clouds remain opaque under the incoming composite');
 for(const property of ['projection','verticalFovDegrees','principalPoint','referenceVerticalSize','referenceAspect'])assert.deepEqual(scene.requireComponent('landing-camera','Camera')[property],scene.requireComponent('biome-camera','Camera')[property],'Camera handoff preserves the outgoing projection');
 at(4640);const landed=point('landing-ship');assert(Math.abs(landed.x-440.81)<.01);assert(Math.abs(landed.y-198.96)<.01);
 at(4620);const approach=point('landing-ship');assert(Math.abs(approach.x-landed.x-66.0418)<.02);assert(Math.abs(approach.y-landed.y+34.3721)<.02);
 at(4680);assert.deepEqual(point('landing-ship'),landed);assert.equal(scene.parents.get('landing-pilot').id,'landing-ship');assert(scene.world.get('landing-pilot')[14]>scene.world.get('landing-hull')[14],'Pilot exits from behind the hull');
 for(const [n,frame]of [[4649,4],[4650,2],[4653,3],[4680,0],[4683,1],[4696,1],[4697,4],[4715,4],[4716,0],[4749,3],[4761,3],[4762,4]]){at(n);assert.equal(scene.spriteState('landing-pilot').frame,frame,`Pilot pose at ${n}`);}
 for(const [n,x]of [[4650,426.02],[4697,232.02],[4715,232.02],[4762,158.06],[4788,158.06]]){at(n);assert(Math.abs(point('landing-pilot').x-x)<.02,`Independent pilot placement at ${n}`);}
 at(4788);assert.equal(scene.requireComponent('landing-camera','Vignette').quartic,0);assert(!scene.isActive('landing-helmet-closeup'));
 at(4800);assert(scene.requireComponent('landing-camera','Vignette').quartic>.6);assert(scene.world.get('landing-helmet-closeup')[14]<scene.requireComponent('landing-camera','Vignette').depth,'Close-up palette stays ahead of the vignette');
 at(4867);assert(scene.isActive('landing-helmet-closeup')&&scene.isActive('landing-face-closeup'));assert.equal(scene.requireComponent('landing-face-closeup-art','SpriteRenderer').color.a,Math.fround(5/9));at(4871);assert(!scene.isActive('landing-helmet-closeup'));
 const zoom=[];for(const n of [4936,4937,4938,4939,4940]){at(n);const m=scene.world.get('landing-face-closeup'),camera=scene.requireComponent('landing-camera','Camera');zoom.push(Math.abs(m[0])*.01/(scene.frustumScale(m[14]))*100);}
 for(const [i,expected]of [17.471,19.628,27.059,42.442,71.985].entries())assert(Math.abs(zoom[i]-expected)<.03,`Weighted zoom sample ${i}: ${zoom[i]}`);
 const sequence=data.animation.sequences['landing-and-recollection'];for(const binding of sequence.bindings)if(binding.property.component==='Transform')assert(data.animation.tracks[binding.track].frameNumber.length<=5,'Motion remains sparse');
 assert.equal(data.assets.landing_helmet_red.file,'landing/helmet.png');assert.deepEqual(data.assets.landing_platform_tile.size,{x:10,y:10});
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,captures={};
 try{for(const [name,type,renderer]of [['chromium-dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden');};});
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=4665`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=n=>page.evaluate(async n=>{await scenePlayer.seekFrame(n,{numerator:30,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},n);
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   const state=()=>page.evaluate(()=>JSON.stringify([...scenePlayer.scene.nodes].map(([id,n])=>[id,n.transform,n.components,scenePlayer.scene.world.get(id)])));
   await seek(4665);const first=await shot(),initialState=await state();captures[name]=first;
   for(const n of [4940,4941,4533,4800,4867,4697,4716,4762,4665])await seek(n);
   assert.equal(await state(),initialState,`${name}: seek restores every transform, component and world matrix`);
   // Chromium can retain a different raster layer after removing a live tint.
   // Subpixel silhouette coverage may change, while the authored state is exact.
   // Bound that variation to less than 0.1% of the image, not a shifted sprite.
   const replay=await shot(),rewind=compare(first,replay),a=png(first),b=png(replay);let changed=0;
   for(let i=0;i<a.width*a.height;i++)if([0,1,2].some(c=>Math.abs(a.pixels[i*a.channels+c]-b.pixels[i*b.channels+c])>2))changed++;
   assert(rewind.mae<.05&&changed<a.width*a.height*.001,`${name}: re-entry pixel coverage ${JSON.stringify({...rewind,changed})}`);
   await seek(4867);const transitionImage=png(await shot()),black=(210*transitionImage.width+385)*transitionImage.channels;
   assert([0,1,2].every(c=>transitionImage.pixels[black+c]<3),`${name}: overlapping black faces hide the ship throughout the crossfade`);
   await seek(4940);let im=png(await shot());const pixel=(x,y)=>Array.from(im.pixels.subarray((y*im.width+x)*im.channels,(y*im.width+x)*im.channels+3));
   assert(pixel(100,180).every(v=>v>230),`${name}: left eye visible ${pixel(100,180)}`);assert(pixel(540,180).every(v=>v>230),`${name}: right eye visible ${pixel(540,180)}`);assert(pixel(320,180).every(v=>v<3),`${name}: zoom retains the black face`);
   for(const size of [{width:390,height:844},{width:1920,height:540}]){
    await page.setViewportSize(size);await seek(4665);im=png(await shot());
    for(const x of [2,size.width-3]){const i=(Math.floor(size.height*.15)*im.width+x)*im.channels;assert(im.pixels[i+2]>40,`${name}: expanded sky coverage`);}
    await seek(4533);await seek(4800);assert.equal(await page.evaluate(()=>scenePlayer.scene.cameraNode.id),'landing-camera');
   }
   if(renderer==='dom')assert.equal(await page.locator('canvas').count(),0);assert.deepEqual(errors,[]);
   console.log(`${name}: landing, independent pilot grid, weighted zoom, expanded aspect and rewind passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
 const parity=compare(captures['chromium-dom'],captures.babylon);assert(parity.mae<4,`Landing renderer agreement: ${JSON.stringify(parity)}`);console.log('Landing renderer mean difference:',parity.mae);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
