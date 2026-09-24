const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),rate=frameRate(120),scene=new Scene(data,pathToFileURL(file).href);
 const at=n=>{scene.setFrameTime(Time.fromFrame(n*4),rate);scene.updateWorld();};
 for(const n of [2760.75,2761,2859,2910,2974,3034.75,3035]){at(n);assert.equal(scene.cameraNode.id,n>=2761&&n<3035?'destruction-camera':n===3035?'return-camera':'helmet-flat-camera');assert.equal(scene.nodes.has('destruction-scene'),n>=2761&&n<3035);}
 at(2859);const v=scene.viewMatrix,s=scene.frustumScale(v[14]);assert(Math.abs(v[12]/s)<1e-9&&Math.abs(v[13]/s)<1e-9,'The hull pivot is centered at the authored front pose');
 for(const [n,d]of [[2910,.57824],[2919,.68],[2930,1.40],[2940,2.47],[2974,7.4062]]){at(n);assert(Math.abs(-scene.transformAt('destruction-camera').localPosition.z-d)<.025,`Physical pullback distance at ${n}`);}
 const [whiteStart,whiteEnd]=data.reconstruction.bossDestruction.hullFlash.rampFrames;
 for(const [n,visible]of [[2861,0],[2862,1],[2863,0],[2867,1],[2870,1],[2872,1],[2873,0],[2876,1],[2878,0],[2903,1],[2907,0]]){at(n);const expected=visible?1:Math.max(0,Math.min(1,(n-whiteStart)/(whiteEnd-whiteStart)));assert(Math.abs(scene.requireComponent('destruction-hull','SpriteRenderer').whiteMix-expected)<.001,`Flash boundary ${n}`);assert(!scene.nodes.has('destruction-flash'),'The flash changes the hull material without a coplanar duplicate');}
 at(2878);const first=JSON.stringify(scene.world.get('destruction-camera')),particles=JSON.stringify(scene.particleStates('destruction-smoke'));
 for(const n of [3035,2799,2686,2974,2878])at(n);assert.equal(JSON.stringify(scene.world.get('destruction-camera')),first);assert.equal(JSON.stringify(scene.particleStates('destruction-smoke')),particles);
 const original=structuredClone(scene.find('destruction-camera').transform);
 for(const n of [2771.25,2847.75,2859,2919.25]){
  const time=Time.fromRatio(n*4,120),sample=scene.matrixAt('destruction-camera',time);at(n);const actual=scene.world.get('destruction-camera');
  assert(sample.every((v,i)=>Math.abs(v-actual[i])<1e-8),'Off-time hierarchy sampling shares the same animated/noisy pose');
 }
 assert.deepEqual(scene.find('destruction-camera').transform,original,'Noise never mutates authored transforms');
 at(2700);assert.deepEqual(scene.matrixAt('evasion-scene').slice(12,15),[0,0,0],'The outgoing shot stays in its original space before the dissolve');
 at(2878);const camera=scene.requireComponent('destruction-camera','TransformNoise');camera.seed+=1;scene.find('destruction-camera').components.find(c=>c.type==='TransformNoise').seed+=1;scene.updateWorld();assert.notEqual(JSON.stringify(scene.world.get('destruction-camera')),first,'The seed controls the deterministic shake');
 const sprite=data.assets.boss_smoke_atlas,im=png(fs.readFileSync(path.join(root,'assets',sprite.file))),stride=sprite.atlas.cellSize.x+2;
 assert.equal(sprite.atlas.frameCount,5);for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++)if(y===0||y===im.height-1||x%stride===0||x%stride===stride-1)assert.equal(im.pixels[(y*im.width+x)*4+3],0,'The smoke atlas has transparent gutters');
 assert.equal(sprite.atlas.cellSize.x,32);assert.equal(sprite.filter,'point');
 for(let i=0;i<im.pixels.length;i+=4){const a=im.pixels[i+3];assert(a===0||a===255,'Smoke has binary coverage, without resampled edge alpha');if(a)assert.deepEqual(Array.from(im.pixels.subarray(i,i+3)),[255,255,255],'All smoke cells share one color');}
 for(const phase of [3,4]){const x=phase*stride+1+13,y=1+12;assert.equal(im.pixels[(y*im.width+x)*4+3],0,'Both crescent frames retain the inner cut');}
 at(2772);assert(scene.requireComponent('destruction-hull','SpriteRenderer').depthWrite);
 const fitted=data.reconstruction.bossDestruction.impacts.events;
 assert.deepEqual(fitted.slice(0,4).map(e=>e.start),[2759,2768,2776,2785]);
 for(let i=0;i<4;i++){
  const a=data.assets.deck_impact_atlas,e=fitted[i],w=scene.world.get(`destruction-impact-${i}`),u=a.pivot.x*a.atlas.cellSize.x,v=e.contactNative.centerRow,x=(u-a.pivot.x*a.atlas.cellSize.x)/a.pixelsPerUnit,y=((1-a.pivot.y)*a.atlas.cellSize.y-v)/a.pixelsPerUnit;
  const z=w[2]*x+w[6]*y+w[14];assert(Math.abs(z)<1e-8,'The fitted native cut really intersects hull world Z=0');
  assert(Math.abs(w[6])>1e-4,'The explosion crosses the surface instead of lying on a pasted alpha mask');
 }
 const beam='destruction-transition-beam';at(2980);assert(!scene.isActive(beam));at(2981);assert(scene.isActive(beam));
 assert.equal(scene.parents.get(beam).id,'destruction-scene','The beam belongs to world space, not the camera');
 const beamWorld=JSON.stringify(scene.world.get(beam)),fit=data.reconstruction.bossDestruction.transitionBeam,unit=fit.worldUnitsPerReferencePixel;
 for(const [n,width]of [[2981,4.17],[2992,10.37],[3000,24.46],[3012,67.71],[3020,119.95],[3028,212.17],[3032,299.74],[3033,337.70]]){
  at(n);assert.equal(JSON.stringify(scene.world.get(beam)),beamWorld,'Camera shake cannot move the world beam');
  assert(Math.abs(scene.requireComponent(beam,'LineRenderer').width/unit-width)<.5,`Fitted two-key beam width at ${n}`);
 }
 const widthBinding=data.animation.sequences['boss-destruction'].bindings.find(b=>b.object===beam&&b.property.path==='width');assert.equal(data.animation.tracks[widthBinding.track].frameNumber.length,2);
 at(3034);assert.equal(scene.requireComponent(beam,'LineRenderer').viewportExpansion,1);assert(scene.requireComponent('destruction-camera','TransformNoise').duration>(3034-2761)/30);assert(fit.rmsPixels<.2);
 const rings=data.reconstruction.bossDestruction.shockRings;
 assert.equal(rings.objects.length,6);assert.equal(rings.radiusKeyCount,12);
 assert.deepEqual(rings.objects.slice(3,5).map(o=>[o.direction,o.observations[0].frame]),[['expand',2985],['expand',2986]]);
 for(const ring of rings.objects){
  const bindings=data.animation.sequences['boss-destruction'].bindings.filter(b=>b.object===ring.entity&&b.property.path.startsWith('size.'));
  assert.equal(bindings.length,2);assert.equal(bindings[0].track,bindings[1].track,'Both diameter axes share one scalar radius track');
  const keys=data.animation.tracks[bindings[0].track].frameNumber;assert.equal(keys.length,2);assert(keys.every(Number.isInteger));
  for(const o of ring.observations){at(o.frame);const c=scene.requireComponent(ring.entity,'PlaneRenderer');assert(scene.isActive(ring.entity));assert(Math.abs(c.size.x/(2*rings.worldUnitsPerReferencePixel)-o.outerRadiusEstimate)<.25,`${ring.entity}: measured radius at ${o.frame}`);assert.equal(c.size.x,c.size.y);assert.equal(c.innerRadiusRatio,rings.innerRadiusRatio);}
 }
 at(2981);assert(!scene.spriteState('destruction-pixel-ring-large').visible);
 for(const n of [2982,2983,2984,2985,2986]){at(n);for(const id of ['destruction-pixel-ring-large','destruction-pixel-ring-small'])assert(scene.spriteState(id).visible);}
 at(2989);for(const ring of rings.objects)assert(!scene.isActive(ring.entity));
 const bad=structuredClone(data),rig=bad.root.children.find(n=>n.id==='destruction-camera-rig'),noise=rig.children[0].children[0].children[0].components.find(c=>c.type==='TransformNoise');noise.seed=.5;assert.throws(()=>new Scene(bad,'http://localhost/scene.json'),/seed/);
 console.log('Destruction: sparse camera curves, pivot, flash boundaries, deterministic noise and particles, off-time sampling and alpha atlas passed.');
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,images=new Map(),out=path.join(root,'test-results/destruction');fs.mkdirSync(out,{recursive:true});
 try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch(type===chromium?{headless:true,channel:'msedge'}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=2878`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=n=>page.evaluate(async n=>{await scenePlayer.seekFrame(n,{numerator:30,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},n);
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   await seek(2878);const first=await shot();images.set(name,first);fs.writeFileSync(path.join(out,`${name}_2878.png`),first);
   for(const n of [2764,2768,2799,2859,2862,2919,2974,3035,2878])await seek(n);
   assert(compare(first,await shot()).mae<.001,`${name}: deterministic re-entry`);
   if(renderer==='babylon'){
    // During the last orbit there are no visible effects behind the hull.
    // Its own depth prepass must leave the DoF color image exactly unchanged,
    // including fractional frames reached after seeking backwards.
    for(const n of [2843,2845,2845.25,2845.5,2847,2857,2844.75]){
     await page.evaluate(async n=>{await scenePlayer.seekFrame(n*4,{numerator:120,denominator:1});await scenePlayer.whenIdle();},n);
     const withDepth=await shot();
     await page.evaluate(async()=>{const p=scenePlayer;p.scene.requireComponent('destruction-hull','SpriteRenderer').depthWrite=false;await p.renderer.update(p.scene,p.view);});
     const difference=compare(withDepth,await shot());assert(difference.max<=1&&difference.mae<.001,`${name}: orbit must not self-occlude at ${n}: ${JSON.stringify(difference)}`);
    }
    await seek(2878);
   }
   if(renderer==='dom'){
    assert.equal(await page.locator('canvas').count(),0);
    const changes=await page.evaluate(async()=>{let n=0;const o=new MutationObserver(r=>n+=r.length);o.observe(scenePlayer.renderer.world,{attributes:true,childList:true,subtree:true});await scenePlayer.update();await Promise.resolve();o.disconnect();return n;});assert.equal(changes,0,'A paused redraw retains DOM surfaces and filter attributes');
   }
   for(const n of [2981,2982,2983,2984,2985,2986,2987,2988,2989,2990,3000,3010,3020,3033,3034]){await seek(n);const bytes=await shot();fs.writeFileSync(path.join(out,`${name}_beam_${n}.png`),bytes);if(n<=2989)images.set(`${name}-${n}`,bytes);}
   await seek(2985);const ringShot=await shot();await seek(3035);await seek(2985);assert(compare(ringShot,await shot()).mae<.001,`${name}: reverse seek restores annuli and atlas phases`);await seek(3034);
   const covered=()=>shot().then(buffer=>{const image=png(buffer);let minimum=255;for(let i=0;i<image.pixels.length;i+=image.channels)for(let c=0;c<3;c++)minimum=Math.min(minimum,image.pixels[i+c]);assert(minimum>=253,`${name}: world beam covers the entire viewport at frame 3034, minimum ${minimum}`);});
   await covered();
   for(const size of [{width:360,height:800},{width:1440,height:360}]){await page.setViewportSize(size);await page.evaluate(()=>scenePlayer.onResize());await seek(2919);fs.writeFileSync(path.join(out,`${name}_${size.width}.png`),await shot());await seek(3034);await covered();fs.writeFileSync(path.join(out,`${name}_beam_3034_${size.width}.png`),await shot());}
   const timing=await page.evaluate(async()=>{const a=[];for(let i=0;i<60;i++){const t=performance.now();await scenePlayer.seekFrame(2878*4+i,{numerator:120,denominator:1});a.push(performance.now()-t);}a.sort((x,y)=>x-y);return {median:a[30],p95:a[57]};});
   assert.deepEqual(errors,[]);console.log(`${name}: replay, aspect expansion and alpha composition passed; update CPU ms ${JSON.stringify(timing)}`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
 for(const name of ['firefox-dom','babylon']){const diff=compare(images.get('dom'),images.get(name));assert(diff.mae<3.5,`${name}: smoke grouping must agree across renderers: ${JSON.stringify(diff)}`);console.log(`DOM / ${name} RGB MAE: ${diff.mae.toFixed(3)}`);}
 for(const name of ['firefox-dom','babylon'])for(const n of [2981,2983,2985,2986,2988]){const diff=compare(images.get(`dom-${n}`),images.get(`${name}-${n}`));assert(diff.mae<3,`${name}: annulus parity at ${n}: ${JSON.stringify(diff)}`);console.log(`DOM / ${name} rings ${n} MAE: ${diff.mae.toFixed(3)}`);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
