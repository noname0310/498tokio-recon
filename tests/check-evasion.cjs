const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),scene=new Scene(data,pathToFileURL(file).href),rate=frameRate(30);
 const at=n=>{scene.setFrameTime(Time.fromDecimal(n),rate);scene.updateWorld();};
 for(const n of [2685.999,2686,2691.999,2692,2767.999,2768,2686]){
  at(n);assert.equal(scene.nodes.has('evasion-scene'),n>=2686&&n<2768);
  if(n>=2686)assert.equal(scene.cameraNode.id,n>=2761?'destruction-camera':'helmet-flat-camera');
  const blur=scene.requireComponent('helmet-flat-camera','GaussianBlur');assert.equal(blur.enabled,n>=2686&&n<2692);
 }
 const sequence=data.animation.sequences['boss-evasion'],shipTrack=sequence.bindings.find(b=>b.object==='evasion-ship'&&b.property.path==='localPosition.x');
 assert.equal(data.animation.tracks[shipTrack.track].frameNumber.length,5,'Two fitted moves and a hold, with offscreen continuation');
 for(const [n,x]of [[2692,-.58],[2696,.947],[2703,1.553],[2730,2.557]]){at(n);assert(Math.abs(scene.transformAt('evasion-ship').localPosition.x-x)<.015,`Source hull anchor at ${n}`);assert.deepEqual(scene.transformAt('evasion-ship').localRotation,{x:0,y:0,z:0});}
 for(const [i,start]of [2686,2691,2696,2701,2706].entries()){
  at(start);assert(scene.isActive(`evasion-beam-${i}-0`));at(start+10);assert(!scene.isActive(`evasion-beam-${i}-0`));
 }
 at(2702);assert.equal(scene.particleStates('evasion-launch-rockets').length,0);
 at(2710);assert.equal(scene.parents.get('evasion-launch-rockets').id,'evasion-ship');
 // A clearly visible lower rocket reverses near frames 2707-2708 and then
 // accelerates left. Coordinates are independently measured body centres.
 let trackedId;
 for(const [n,x,y]of [[2707,561.6,196],[2708,558.6,207],[2709,534.6,217],[2710,493,224.5],[2713,309.4,240],[2716,73.9,250]]){
  at(n);const particles=scene.particleStates('evasion-launch-rockets');
  trackedId??=particles.reduce((a,b)=>Math.hypot(a.position.x*100+320-x,180-a.position.y*100-y)<Math.hypot(b.position.x*100+320-x,180-b.position.y*100-y)?a:b).id;
  const p=particles.find(p=>p.id===trackedId);assert(p);assert(Math.hypot(p.position.x*100+320-x,180-p.position.y*100-y)<8,`Tracked launch at ${n}`);
 }
 at(2706.5);const early=scene.particleStates('evasion-launch-rockets').find(p=>p.id===trackedId);
 at(2707);const turn=scene.particleStates('evasion-launch-rockets').find(p=>p.id===trackedId);assert(turn.position.x>early.position.x,'Rocket initially travels behind the ship');
 at(2708.5);const late=scene.particleStates('evasion-launch-rockets').find(p=>p.id===trackedId);assert(late.position.x<turn.position.x,'Then reverses toward forward flight');
 for(const n of [2716,2716.5,2717,2746,2747]){
  at(n);
  for(const id of ['evasion-launch-rockets','evasion-small-rockets','evasion-large-rockets']){
   const component=scene.requireComponent(id,'ParticleEmitter');assert.equal(component.space,'local');
   for(const state of scene.particleStates(id))assert.equal(state.frame,id==='evasion-large-rockets'?Math.floor(n)%2:1-Math.floor(n)%2,'Global atlas phase does not depend on birth time');
  }
 }
 at(2746);const expected=JSON.stringify(scene.particleStates('evasion-small-rockets'));
 const focus=scene.requireComponent('evasion-large-rockets','ParticleMotionBlur');assert.equal(focus.shutterSeconds,0);assert.equal(focus.dilationPixels,0);assert(focus.softnessPixels>.20&&focus.softnessPixels<.23);
 assert(!scene.component('evasion-small-rockets','ParticleMotionBlur'));for(const p of scene.particleStates('evasion-large-rockets'))assert.deepEqual(p.blurUV,{x:0,y:0},'Foreground softness adds no velocity streak');
 for(const n of [2768,2690,2746,2685,2746])at(n);assert.equal(JSON.stringify(scene.particleStates('evasion-small-rockets')),expected);
 const old=scene.requireComponent('evasion-small-rockets','ParticleEmitter');old.animation.timeSource='age';
 assert(new Set(scene.particleStates('evasion-small-rockets').map(p=>p.frame)).size>1,'Age-based animation is still available');
 for(const [n,a]of [[2759,0],[2760,1/16],[2764,9/16],[2767,15/16],[2767.5,1]]){at(n);assert.equal(scene.requireComponent('evasion-fade','PlaneRenderer').color.a,a);}
 const atlas=png(fs.readFileSync(path.join(root,'assets/asteroid_field/rocket_atlas.png')));assert.equal(atlas.width,58);assert.equal(atlas.height,15);
 for(let y=0;y<15;y++)for(let x=0;x<58;x++)if(y===0||y===14||[0,28,29,57].includes(x))assert.equal(atlas.pixels[(y*58+x)*4+3],0,'Transparent gutters');
 const invalid=structuredClone(data),bad=invalid.animation.sequences['boss-evasion'].objects[0].template.children.find(n=>n.id==='evasion-background');bad.components[0].brightness=-1;
 assert.throws(()=>new Scene(invalid,pathToFileURL(file).href),/brightness/);
 console.log('Evasion: sparse source poses, exact cuts and fade, synchronized atlas phase, age fallback and deterministic particles passed.');
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,out=path.join(root,'test-results/evasion');fs.mkdirSync(out,{recursive:true});
 try{for(const [label,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch(type===chromium?{headless:true,...(process.argv.includes('--edge')?{channel:'msedge'}:{executablePath:chromium.executablePath()})}:{headless:true});try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=2686`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=n=>page.evaluate(async n=>{await scenePlayer.seekFrame(n*4,{numerator:120,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},n);
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   await seek(2686);const blurred=await shot();fs.writeFileSync(path.join(out,`${label}_2686.png`),blurred);
   await seek(2692);await page.evaluate(()=>{const r=scenePlayer.renderer;window.keptBackground=r.objects.find(o=>o.id==='evasion-background');});
   // The independent source star at (422.5, 15.5) at frame 2716.
   await seek(2716);const sharp=png(await shot());let peak=0;for(let y=11;y<=19;y++)for(let x=418;x<=427;x++){const i=(y*sharp.width+x)*sharp.channels;peak=Math.max(peak,sharp.pixels[i]);}assert(peak>230,`${label}: shared tile receives the measured brighter exposure`);
   const fadeFrames=new Map();
   for(const n of [2703,2704,2717,2730,2746,2754,2760,2761,2764,2767]){await seek(n);const image=await shot();fs.writeFileSync(path.join(out,`${label}_${n}.png`),image);if(n>=2760)fadeFrames.set(n,image);}
   assert(await page.evaluate(()=>scenePlayer.renderer.objects.find(o=>o.id==='evasion-background')===window.keptBackground));
   // Re-enter the outgoing chapter after it has been disposed. A stale
   // camera-parent matrix used to sort rockets in front of the fade plane.
   for(const n of [2767,2764,2761,2760]){
    await seek(2768);await seek(n);const difference=compare(await shot(),fadeFrames.get(n));
    assert(difference.max<=1&&difference.mae<.001,`${label}: fade is independent of seek direction at ${n}: ${JSON.stringify(difference)}`);
   }
   await seek(2754);
   const isolate=async enabled=>page.evaluate(async enabled=>{const p=scenePlayer,s=p.scene;for(const o of p.renderer.objects)if(o.id!=='evasion-large-rockets')s.active.set(o.id,false);s.requireComponent('evasion-large-rockets','ParticleMotionBlur').enabled=enabled;await p.renderer.update(s,p.view);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},enabled);
   await isolate(true);const soft=await shot();fs.writeFileSync(path.join(out,`${label}_foreground_soft.png`),soft);
   await isolate(false);const crisp=await shot();fs.writeFileSync(path.join(out,`${label}_foreground_crisp.png`),crisp);
   const energy=buffer=>{const p=png(buffer);let e=0;for(let y=1;y<p.height;y++)for(let x=1;x<p.width;x++){const i=(y*p.width+x)*p.channels;for(let c=0;c<3;c++)e+=(p.pixels[i+c]-p.pixels[i+c-p.channels])**2+(p.pixels[i+c]-p.pixels[i+c-p.width*p.channels])**2;}return e;};
   assert(energy(crisp)>0);assert(energy(soft)<energy(crisp)*.8,`${label}: foreground edges receive a visible focus blur`);
   await seek(2754);const builds=await page.evaluate(()=>scenePlayer.renderer.objects.find(o=>o.id==='evasion-large-rockets').filter?.renderCount??0);await seek(2755);
   assert.equal(await page.evaluate(()=>scenePlayer.renderer.objects.find(o=>o.id==='evasion-large-rockets').filter?.renderCount??0),builds,`${label}: atlas frame changes reuse the filtered texture`);
   for(const size of [{width:360,height:800},{width:1440,height:360}]){
    await page.setViewportSize(size);await page.evaluate(()=>scenePlayer.onResize());await seek(2746);fs.writeFileSync(path.join(out,`${label}_${size.width}.png`),await shot());
    const camera=await page.evaluate(()=>scenePlayer.scene.cameraNode.id);assert.equal(camera,'helmet-flat-camera');
   }
   await page.setViewportSize({width:640,height:360});await page.evaluate(()=>scenePlayer.onResize());await seek(2768);assert.equal(await page.evaluate(()=>scenePlayer.renderer.objects.some(o=>o.id.startsWith('evasion-'))),false);
   await seek(2686);const replay=await shot(),difference=compare(blurred,replay);fs.writeFileSync(path.join(out,`${label}_replay.png`),replay);assert(difference.mae<.001,`${label}: blur and chapter replay are deterministic: ${JSON.stringify(difference)}`);assert.deepEqual(errors,[]);
   console.log(`${label}: camera blur, tile gain, atlas updates, retained background, expanded viewports and rewind passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
