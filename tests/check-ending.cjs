const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
const style='.runtime-loading-status{visibility:hidden!important}';
function border(buffer,view,frame){
 const p=png(buffer),u=view.pixelsPerUnit,t=Math.max(0,Math.min(1,(frame-6638)/27)),r=.2*u;
 const left=.23*u,top=.23*u,right=view.width-(.5*(1-t)*view.width+(.1+.1*t)*u),bottom=view.height-.21*u;
 let checked=0;
 for(const [cx,cy,sx,sy]of [[left+r,top+r,-1,-1],[right-r,top+r,1,-1],[left+r,bottom-r,-1,1],[right-r,bottom-r,1,1]]){
  for(let a=2;a<r+2;a+=2)for(let b=2;b<r+2;b+=2){
   const x=Math.floor(cx+sx*a),y=Math.floor(cy+sy*b),distance=Math.hypot(x+.5-cx,y+.5-cy)-r;
   if(Math.abs(distance)<1.7)continue;
   const i=(y*p.width+x)*p.channels,bright=Math.max(...p.pixels.subarray(i,i+3));
   assert(distance>0?bright<4:bright>25,`F${frame} ${view.width}x${view.height} rounded boundary at ${x},${y}: distance ${distance}, pixel ${bright}`);checked++;
  }
 }
 assert(checked>30,'Every aperture size tests the same circular radius');
}
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),scene=new Scene(data,pathToFileURL(file).href),rate=frameRate(30);
 const at=f=>{scene.setFrameTime(Time.fromDecimal(f),rate);scene.updateWorld();};
 // Real playback evaluates subframes; integer-only seeks missed the repeating
 // decimal frequency that overflowed time arithmetic after the hull flash.
 for(let f=6317;f<6387;f+=.5){at(f+.1234567);for(const id of scene.nodes.keys())if(scene.component(id,'ParticleEmitter'))scene.particleStates(id);}
 at(6115);assert(!scene.component('ending-city-ship','TransformNoise'));assert(!scene.nodes.has('ending-city-ship-smoke'));
 at(6307);const still=scene.world.get('ending-departure-ship').slice();at(6307.75);assert.deepEqual(scene.world.get('ending-departure-ship'),still,'No shake before its measured onset');
 at(6308);const jitter=scene.world.get('ending-departure-ship').slice();assert.notDeepEqual(jitter,still);at(6308.5);assert.notDeepEqual(scene.world.get('ending-departure-ship'),jitter,'Procedural shake interpolates at subframes');at(6335);at(6308);assert.deepEqual(scene.world.get('ending-departure-ship'),jitter,'Shake is independent of seek history');
 for(const [f,head]of [[6198,91.70],[6199,77.98],[6200,72.07],[6204,68.97],[6205,73.35],[6206,86.12]]){at(f);const actual=180-scene.world.get('ending-pilot-standing')[13]*100-26*2.494;assert(Math.abs(actual-head)<.75,`Three-key jump at F${f}: ${actual} versus ${head}`);}
 at(6160);const firstWalk=scene.spriteState('ending-departure-pilot').frame;at(6163);assert.notEqual(scene.spriteState('ending-departure-pilot').frame,firstWalk,'Walking cycles while moving behind the ship');
 at(6270);assert(!scene.isActive('ending-paper-launched'));at(6271);assert(scene.isActive('ending-paper-launched'));
 assert(!data.assets.ending_pilot_holding);assert(!fs.existsSync(path.join(root,'assets/ending/pilot_holding_atlas.png')));
 at(6220);assert.equal(scene.requireComponent('ending-pilot-standing','SpriteRenderer').asset,'helmet_pilot_front');assert(scene.isActive('ending-paper-held'));
 at(6244);assert.equal(scene.requireComponent('ending-pilot-left','SpriteRenderer').asset,'helmet_pilot_blue');assert(scene.isActive('ending-paper-held'));at(6271);assert(!scene.isActive('ending-paper-held'));
 for(const birth of [6310,6321,6332,6343,6354,6365,6376]){
  for(let phase=0;phase<4;phase++){at(birth+phase*2);const particles=scene.particleStates('ending-departure-explosions');assert.equal(particles.length,1);assert.equal(particles[0].frame,phase);}
  at(birth+8);assert.equal(scene.particleStates('ending-departure-explosions').length,0);
 }
 for(const [f,white]of [[6317,0],[6318,1],[6326,1],[6327,0],[6338,1],[6347,0],[6357,1],[6366,0],[6377,1],[6386,1],[6387,0]]){
  at(f);assert.equal(scene.requireComponent('ending-departure-ship','SpriteRenderer').whiteMix,white);assert.equal(scene.requireComponent('ending-departure-thruster','SpriteRenderer').whiteMix,white);
  const c=scene.requireComponent('ending-departure-exhaust','ParticleEmitter');for(let row=0;row<3;row++){assert.equal(c.colorMatrix[row*4+row],1-white);assert.equal(c.colorMatrix[row*4+3],white);}
 }
 for(const f of [6387,6393,6404]){
  at(f);const b=scene.requireComponent('ending-departure-ship','SpriteRenderer').brightness;
  assert.equal(scene.requireComponent('ending-departure-thruster','SpriteRenderer').brightness,b);
  const c=scene.requireComponent('ending-departure-exhaust','ParticleEmitter');for(const axis of ['r','g','b'])assert.equal(c.color[axis],b);
 }
 for(const [f,id]of [[5670,'storm-smoke'],[5880,'storm-rear-smoke'],[6230,'ending-departure-smoke']]){at(f);const states=scene.particleStates(id);assert(states.length>0);for(const p of states){assert.equal(p.matrix[1],0);assert.equal(p.matrix[4],0);assert.equal(p.localPosition.z,0,'Smoke velocity never drifts through the hull');}}
 at(6694);assert.equal(scene.requireComponent('ending-final-pilot','SpriteRenderer').asset,'ending_helmet_closed');assert.equal(scene.requireComponent('ending-final-adult','SpriteRenderer').asset,'landscape_adult');assert.equal(scene.requireComponent('ending-final-adult','SpriteRenderer').frame,4);assert(!data.assets.ending_scorch);
 assert(scene.world.get('ending-final-pilot')[14]<scene.world.get('ending-final-ship')[14],'Closed helmet sits in front of the hull');
 const ranges=[['city-flight',5978,6123],['departure',6123,6416],['credits',6416,6711],['thanks',6711,6901]];
 for(const [name,start,end]of ranges)for(const f of [start-1,start,end-1,end]){at(f);assert.equal(scene.nodes.has(`ending-${name}-world`),f>=start&&f<end);}
 at(6475);assert.equal(scene.cameraNode.id,'ending-camera');assert(scene.component('ending-camera','ViewportFrame').enabled);
 const pattern=scene.world.get('ending-credits-pattern').slice();scene.cameraNode.transform.localPosition.x+=.25;scene.updateWorld();assert(Math.abs(scene.world.get('ending-credits-pattern')[12]-pattern[12]-.25)<1e-8,'Credit sky follows the camera');
 at(6592);assert.deepEqual(scene.requireComponent('ending-credits-pattern','TiledSpriteRenderer').origin,{x:-3.2,y:1.8},'Credit sky has no independent scroll');
 for(const width of [6.4,12.8,6.4]){scene.setViewport({worldWidth:width,worldHeight:3.6});const x=scene.world.get('ending-text-creator')[12]-scene.world.get('ending-camera')[12];assert(Math.abs(x-width/4)<1e-6,'Credits stay centered in the right half at any aspect ratio');}
 let exhaustProfile;
 for(const [f,id]of [[3102,'return-forward-exhaust'],[5880,'storm-forward-exhaust'],[6098,'ending-city-exhaust']]){
  at(f);const c=scene.requireComponent(id,'ParticleEmitter'),profile={direction:c.direction,speed:c.speed,spread:c.spreadDegrees,rate:c.rate,lifetime:c.lifetime,startSize:c.startSize,sizeOverLife:c.sizeOverLife};
  if(exhaustProfile)assert.deepEqual(profile,exhaustProfile,'Rear flights share the complete local exhaust distribution, not only speed');else exhaustProfile=profile;
  assert(c.direction.y<0&&c.direction.z<0,'Exhaust travels below the nozzle toward the camera');assert(scene.component(id,'SortingGroup'),'Exhaust cannot drift behind the hull');
  const particles=JSON.stringify(scene.particleStates(id));at(f+3);at(f);assert.equal(JSON.stringify(scene.particleStates(id)),particles,'Rear exhaust is deterministic after seeking');
 }
 at(6102);for(const layer of ['front','middle','far']){const id='ending-city-'+layer,m=scene.world.get(id),blur=scene.requireComponent(id,'GaussianBlur'),shadow=scene.requireComponent(id,'DropShadow');assert(Math.abs(blur.sigmaWorld.y*m[5]*100-1.9)<1e-6,'City defocus is measured in projected pixels');assert(shadow.enabled&&shadow.opacity>0&&shadow.offsetWorld.y<0,'Each city silhouette casts its own soft shadow');}
 at(6244);assert(scene.world.get('ending-paper-held')[14]>scene.world.get('ending-pilot-left')[14],'Held paper is behind the pilot');at(6271);assert(scene.world.get('ending-paper-launched')[14]>scene.world.get('ending-pilot-left')[14],'Released paper stays behind the pilot');
 at(6711);assert(!scene.component('ending-camera','ViewportFrame').enabled);assert.equal(scene.requireComponent('ending-thanks-text','TextRenderer').text,'THANK YOU FOR YOUR TIME !!');
 at(230.016871*30);assert(scene.nodes.has('ending-thanks-text'),'End card holds through the copied AAC encoder tail');
 for(const [f,x]of [[6675,516.22],[6676,449.45],[6677,406.29],[6678,374.46],[6680,335.47],[6685,311.6]]){at(f);assert(Math.abs(scene.world.get('ending-final-ship')[12]*100+320-x)<2,'Two-key weighted arrival passes the measured hull positions');}
 for(const f of [6170,6300,6386,6690]){at(f);for(const id of scene.nodes.keys()){const c=scene.component(id,'ParticleEmitter');if(id.startsWith('ending-')&&c)assert.notEqual(c.asset,'asteroid_rocket_atlas','Flight prefab must not retain its old rocket attack');}}
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer]of [['Chromium DOM',chromium,'dom'],['Firefox DOM',firefox,'dom'],['Babylon WebGL2',chromium,'babylon']]){
  const browser=await type.launch({headless:true});try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=6475`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=f=>page.evaluate(async f=>{await scenePlayer.seekFrame(f);await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},f);
   await page.evaluate(()=>{window.playbackErrors=[];scenePlayer.onError(e=>window.playbackErrors.push(String(e)));});
   await seek(6317);await page.evaluate(async()=>{scenePlayer.setPlaybackRate(4);await scenePlayer.play();});
   await page.waitForFunction(()=>scenePlayer.time*30>6386,null,{timeout:15000});
   await page.evaluate(()=>{scenePlayer.pause();scenePlayer.setPlaybackRate(1);});assert.deepEqual(await page.evaluate(()=>window.playbackErrors),[],'Audio-clock playback through repeated flashes must not overflow');
   await seek(6475);const original=await page.screenshot({style});
   for(const f of [6690,6123,6035,6416,6390,6750,6475])await seek(f);
   const diff=compare(original,await page.screenshot({style}));assert(diff.mae<.01&&diff.max<5,`${name} reverse seek: ${JSON.stringify(diff)}`);
   for(const size of [{width:640,height:360},{width:390,height:844},{width:1280,height:320}]){
    await page.setViewportSize(size);
    await seek(6475);
    const alignment=await page.evaluate(()=>{const e=scenePlayer,id='ending-text-creator',p=e.scene.world.get(id),camera=e.scene.world.get(e.scene.cameraNode.id),x=e.view.width/2+(p[12]-camera[12])*e.view.pixelsPerUnit;let backendX=x;
     if(e.renderer.kind==='babylon'){const n=e.renderer.nodes.get(id);n.computeWorldMatrix(true);backendX=e.view.width/2+(n.getWorldMatrix().m[12]-camera[12])*e.view.pixelsPerUnit;}
     return {x,backendX,expected:e.view.width*.75};});
    assert(Math.abs(alignment.x-alignment.expected)<.001&&Math.abs(alignment.backendX-alignment.expected)<.001,`${name}: responsive credit alignment ${JSON.stringify(alignment)}`);
    for(const f of [6638,6650,6665]){await seek(f);border(await page.screenshot({style}),await page.evaluate(()=>scenePlayer.view),f);}
   }
   await seek(6899);assert(await page.evaluate(()=>scenePlayer.scene.isActive('ending-thanks-text')));assert.deepEqual(errors,[]);
   console.log(`${name}: ending cuts, reverse seeks, fixed-radius expansion at three aspect ratios and final card passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
