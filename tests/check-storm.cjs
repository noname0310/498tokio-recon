const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');

async function main(){
 const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
 const scene=new Scene(data,pathToFileURL(file).href),at=f=>{scene.setFrameTime(Time.fromDecimal(f),frameRate(30));scene.updateWorld();};
 for(const f of [5531.999,5532,5542,5977.999,5978,5977,5826,5531]){
  at(f);assert.equal(scene.nodes.has('storm-world'),f>=5532&&f<5978);
  if(f>=5542&&f<5978)assert.equal(scene.cameraNode.id,'storm-camera');
 }
 for(const [i,f]of [5753,5773,5783,5793,5803,5813,5823,5833].entries()){
  at(f);for(let j=0;j<8;j++)assert.equal(scene.isActive(`storm-stripes-${j}`),j===i,`Exactly one strip at F${f}`);
 }
 const meteorIds=[0,1,2].map(i=>`storm-meteors-${i}`),reference={worldWidth:6.4,worldHeight:3.6};
 const inReference=p=>Math.abs(p.position.x)<3.2+Math.abs(p.matrix[0])/2&&Math.abs(p.position.y)<1.8+Math.abs(p.matrix[5])/2;
 for(const f of [5564,5565,5582,5585,5586,5588,5600]){
  at(f);const states=meteorIds.flatMap(id=>scene.particleStates(id,scene.timelineTime,reference));
  assert(states.every(p=>p.color.a===1),'Meteor entry never fades particle alpha');
  assert.equal(states.filter(inReference).length>0,f>=5586,`First opaque meteor enters at F5586, not a prefilled reveal (${f})`);
  if(f===5564)assert.equal(states.length,0,'No emission before its start');
 }
 at(5600);for(const id of meteorIds)assert.equal(scene.requireComponent(id,'ParticleEmitter').prewarm,0);
 assert.equal(scene.parents.get('storm-smoke').id,'storm-side-ship');
 assert.equal(scene.requireComponent('storm-smoke','ParticleEmitter').space,'local');
 for(const f of [5570,5650,5740,5790]){
  at(f);const z=scene.world.get('storm-side-ship')[14];
  assert(scene.particleStates('storm-smoke').every(p=>p.position.z<z),'Smoke stays in front of its parent hull');
 }
 for(const [id,f]of [['storm-side-ship',5700],['storm-rear-ship',5906]]){
  at(f);const c=scene.requireComponent(id,'TransformNoise'),first=scene.world.get(id).slice();
  assert(c.positionAmplitude.x>0&&c.positionAmplitude.y>0);assert.equal(c.frequency,30);
  at(f+.5);assert.notDeepEqual(scene.world.get(id),first,'Ship jitter remains active between source frames');
  at(f+2);at(f);assert.deepEqual(scene.world.get(id),first,'Procedural ship shake is independent of seek history');
 }
 for(let f=5850;f<5960;f++){
  at(f);const anchor=scene.spriteSortAnchor('storm-forward-exhaust');
  assert(anchor&&anchor.z<scene.world.get('storm-rear-ship')[14],'Exhaust sorting is anchored in front of the hull');
 }
 at(5870);assert.equal(scene.parents.get('storm-rear-smoke').id,'storm-rear-ship');assert.equal(scene.requireComponent('storm-rear-smoke','ParticleEmitter').space,'local');assert(scene.particleStates('storm-rear-smoke').length>0);
 const starsBefore=scene.particleStates('storm-forward-stars-0');at(5871);const starsAfter=new Map(scene.particleStates('storm-forward-stars-0').map(p=>[p.id,p]));
 for(const p of starsBefore){const next=starsAfter.get(p.id);if(!next)continue;const r=Math.hypot(p.localPosition.x,p.localPosition.y),s=Math.hypot(p.matrix[0],p.matrix[1]);const rn=Math.hypot(next.localPosition.x,next.localPosition.y),sn=Math.hypot(next.matrix[0],next.matrix[1]);assert(Math.abs(rn/r-sn/s)<1e-10,'Star size and radial position share the same expansion');assert(rn/r>1.1&&rn/r<1.14);}
 for(const f of [5931,5939]){at(f);const ring=scene.requireComponent(`storm-annulus-${f===5931?5:6}-4`,'PlaneRenderer');assert(ring.color.a>.3&&scene.isActive(`storm-annulus-${f===5931?5:6}-4`),'Faint follow-up ring remains visible');}
 at(5765);const purple={...scene.requireComponent('storm-cloud-0','TiledSpriteRenderer').color};
 at(5785);const orange=scene.requireComponent('storm-cloud-0','TiledSpriteRenderer').color;
 assert(purple.b>purple.g&&orange.g>orange.b,'Clouds continue from magenta to orange after F5760');
 at(5799);assert.equal(scene.requireComponent('storm-cloud-0','TiledSpriteRenderer').color.a,1,'Cloud overlap remains opaque inside the composited dissolve');
 const dissolve=scene.requireComponent('storm-cloud-fade','Transition');assert(dissolve.progress>.55&&dissolve.progress<.65);
 at(5675);const ids=['storm-streak-0','storm-meteors-1','storm-smoke','storm-side-stars-1'];
 const first=ids.map(id=>scene.particleStates(id));at(5977);at(5532);at(5675);assert.deepEqual(ids.map(id=>scene.particleStates(id)),first,'Particles are independent of seek history');
 at(5860);assert.equal(scene.requireComponent('storm-camera','Vignette').enabled,false);assert(!scene.isActive('storm-corridor'));assert(scene.isActive('storm-rear-ship'));
 const radius=f=>{at(f);return scene.world.get('storm-white-exit')[0]*100;};
 for(const [f,r]of [[5910,27],[5930,70],[5950,167],[5960,272],[5963,335]])assert(Math.abs(radius(f)-r)<2,`Measured white disk radius at ${f}`);
 for(const binding of data.animation.sequences['storm-escape'].bindings)if(binding.property.component==='Transform')assert(data.animation.tracks[binding.track].frameNumber.length<=5,'Motion uses sparse curves');
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,shots={};
 try{for(const [label,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true});try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=5675`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=f=>page.evaluate(async f=>{await scenePlayer.seekFrame(f,{numerator:30,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},f);
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   const before=await shot();shots[label]=before;
   for(const f of [5977,5860,5833,5826,5813,5773,5531,5535,5542,5675])await seek(f);
   assert(compare(before,await shot()).mae<.1,`${label}: deterministic reverse seeking`);
   await seek(5799);shots[`${label}-dissolve`]=await shot();
   for(const [f,emitter,hull]of [[5700,'storm-smoke','storm-side-ship'],[5870,'storm-rear-smoke','storm-rear-ship'],[5902,'storm-forward-exhaust','storm-rear-ship'],[5906,'storm-forward-exhaust','storm-rear-ship'],[5910,'storm-forward-exhaust','storm-rear-ship']]){
    await seek(f);const order=await page.evaluate(({emitter,hull,renderer})=>{
     if(renderer==='dom'){
      const hullSurface=document.querySelector(`[data-entity="${hull}"][data-component="SpriteRenderer"]`);
      const particles=[...document.querySelectorAll(`[data-entity="${emitter}"][data-component="ParticleEmitter"]`)].filter(e=>!e.hidden);
      return {hull:Number(hullSurface.style.zIndex),particles:particles.map(e=>Number(e.style.zIndex))};
     }
     const hullObject=scenePlayer.renderer.objects.find(o=>o.id===hull&&o.meshes),particleObject=scenePlayer.renderer.objects.find(o=>o.id===emitter&&o.entries);
     return {hull:hullObject.meshes.get('SpriteRenderer').mesh.alphaIndex,particles:particleObject.entries.filter(e=>e.mesh.isVisible&&e.mesh.isEnabled()).map(e=>e.mesh.alphaIndex)};
    },{emitter,hull,renderer});
    assert(order.particles.length>0&&order.particles.every(rank=>rank>order.hull),`${label}: ${emitter} composites in front of its hull at F${f}`);
   }
   for(const f of [5670,5870,5931,5939,5960]){await seek(f);shots[`${label}-${f}`]=await shot();}
   await seek(5977);const white=png(await shot());assert(white.pixels.every((v,i)=>i%white.channels===3||v>250),`${label}: final white coverage`);
   for(const viewport of [{width:390,height:844},{width:2560,height:540}]){
    await page.setViewportSize(viewport);await seek(5813);const strip=png(await shot());
    for(const [x,y]of [[2,2],[viewport.width-3,viewport.height-3]]){const i=(y*strip.width+x)*strip.channels;assert(Math.max(...strip.pixels.subarray(i,i+3))>100,`${label}: stripe background covers expanded aspect`);}
    await seek(5977);const final=png(await shot());assert(final.pixels.every((v,i)=>i%final.channels===3||v>250),`${label}: white circle covers expanded aspect`);
   }
   if(renderer==='dom')assert.equal(await page.locator('canvas').count(),0);
   assert.deepEqual(errors,[]);console.log(`${label}: storm lifetime, exact switches, rewind and expanded aspect passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
 const difference=compare(shots.dom,shots.babylon);assert(difference.mae<8,`Storm backend agreement: ${JSON.stringify(difference)}`);console.log('Storm mean RGB backend difference:',difference.mae);
 const dissolveDifference=compare(shots['dom-dissolve'],shots['babylon-dissolve']);assert(dissolveDifference.mae<8,`Cloud dissolve backend agreement: ${JSON.stringify(dissolveDifference)}`);console.log('Cloud dissolve mean RGB backend difference:',dissolveDifference.mae);
 for(const f of [5670,5870,5931,5939,5960]){const d=compare(shots[`dom-${f}`],shots[`babylon-${f}`]);assert(d.mae<8,`F${f}: analytic effects agree across renderers (${d.mae})`);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
