const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file)),out=path.join(root,'test-results/asteroid');
const atlas=key=>png(fs.readFileSync(path.join(root,'assets',data.assets[key].file)));
const pixel=(im,x,y)=>[...im.pixels.subarray((y*im.width+x)*im.channels,(y*im.width+x)*im.channels+im.channels)];
const fixture=(emitter,glow)=>({schemaVersion:1,assets:{art:{...data.assets.asteroid_circle_atlas,file:'/assets/asteroid_field/circle_atlas.png'}},root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
 {id:'stream',transform:{localPosition:{x:-5}},components:[{type:'ParticleEmitter',asset:'art',maxParticles:512,seed:987,rate:3,direction:{x:1,y:0,z:0},speed:{min:2,max:2},lifetime:{min:5,max:5},startSize:{min:.22,max:.22},animation:{mode:'fps',framesPerSecond:15,loop:true},...emitter},...(glow?[{type:'Glow',...glow}]:[])]}
]}});
async function numerical(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),scene=new Scene(data,pathToFileURL(file).href),rate=frameRate(30);
 for(const [key,asset]of Object.entries(data.assets).filter(([k])=>k.startsWith('asteroid_')&&k.endsWith('_atlas'))){
  const im=atlas(key),a=asset.atlas;assert.deepEqual([im.width,im.height],[asset.size.x,asset.size.y]);assert.equal(im.channels,4);
  for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){
   const cx=x%(a.cellSize.x+2),cy=y%(a.cellSize.y+2);
   if(cx===0||cx===a.cellSize.x+1||cy===0||cy===a.cellSize.y+1)assert.equal(pixel(im,x,y)[3],0,`${key}: transparent padding`);
  }
 }
 const missile=atlas('asteroid_missile');assert.deepEqual([missile.width,missile.height],[data.assets.asteroid_missile.size.x,data.assets.asteroid_missile.size.y]);
 assert.deepEqual(pixel(missile,7,3),[251,245,240,255],'Neutral white missile highlight must not become a hole');
 const explosion=atlas('asteroid_explosion_atlas');for(const [x,y]of [[5,8],[5,9],[9,7],[6,12]]){
  const c=pixel(explosion,22+x,1+y);assert(c[0]>240&&c[1]>220&&c[2]>150&&c[3]===255,'Pale explosion cores remain opaque');
 }
 const circle=atlas('asteroid_circle_atlas');let changed=0;
 for(let y=0;y<11;y++)for(let x=0;x<11;x++)if(pixel(circle,x+1,y+1)[3]!==pixel(circle,x+14,y+1)[3]){assert(y===5&&(x===3||x===7));changed++;}assert.equal(changed,2);
 const at=n=>{scene.setFrameTime(Time.fromDecimal(n),rate);scene.updateWorld();};
 for(const n of [2255.999,2256,2390,2536.999,2537,2256]){at(n);assert.equal(scene.nodes.has('asteroid-scene'),n>=2256&&n<2537);}
 at(2390);assert.equal(scene.cameraNode.id,'helmet-flat-camera');assert(!scene.component(scene.cameraNode.id,'Vignette')?.enabled);
 assert.equal(scene.component('asteroid-background','TiledSpriteRenderer').wrap.y,'repeat');
 const orbs=[...scene.nodes.keys()].filter(id=>id.startsWith('asteroid-orb-'));
 assert.equal(orbs.length,33);const states=orbs.flatMap(id=>scene.particleStates(id));
 for(const [x,y]of [[192,230],[357.6,227.7],[283,31]])assert(states.some(p=>Math.hypot(320+p.position.x*100-x,180-p.position.y*100-y)<6),'Tracked orb centers match visible source landmarks');
 at(2308);const base=scene.transformAt('asteroid-ship').localPosition;
 for(const [f,x,y]of [[2427,130,92],[2454,197,-99],[2463,195,49],[2471,-142,48],[2480,-56,-132],[2490,138,131]]){
  at(f);const p=scene.transformAt('asteroid-ship').localPosition;assert(Math.abs((p.x-base.x)*100-x)<.002&&Math.abs((p.y-base.y)*100-y)<.002);
 }
 assert(data.animation.tracks['asteroid-ship-x'].frameNumber.length<=24,'Ship motion uses fitted segments, not frame-by-frame keys');
 for(const [f,pose]of [[2441,0],[2442.999,0],[2443,1],[2445,2],[2447,3],[2448.999,3]]){at(f);assert.equal(scene.spriteState('asteroid-explosion-0').frame,pose);}
 at(2449);assert(!scene.isActive('asteroid-explosion-0'));
 const reference={worldWidth:6.4,worldHeight:3.6},wide={worldWidth:40,worldHeight:3.6};
 for(const sign of [1,-1]){
  const def=fixture({direction:{x:sign,y:0,z:0},acceleration:{x:sign*.3,y:0,z:0}});def.root.children[1].transform.localPosition.x=-5*sign;
  const fixed=new Scene(def,'http://localhost/');def.root.children[1].components[0].cameraContinuation={padding:.25};const continued=new Scene(def,'http://localhost/');
  const original=fixed.particleStates('stream',4),ref=continued.particleStates('stream',4,reference),extended=continued.particleStates('stream',4,wide);
  for(const p of ref.filter(p=>p.age>=0&&p.age<5))assert.deepEqual(p,original.find(o=>o.id===p.id),'Continuation preserves authored motion, random phase and color');
  assert(extended.some(p=>p.age<0),'Wide views see the trajectory before the authored birth');
  assert(continued.particleStates('stream',9,wide).some(p=>p.age>p.lifetime),'Wide views see the trajectory after the authored lifetime');
  for(const p of extended.filter(p=>p.age<0))assert(p.frame>=0&&p.frame<2,'Negative-age atlas phases wrap correctly');
  let previous;
  for(let k=0;k<120;k++){
   const next=continued.particleStates('stream',2+k/120,wide),ids=new Set(next.map(p=>p.id));
   if(previous){
    for(const p of next)if(!previous.has(p.id))assert(Math.abs(p.position.x)>wide.worldWidth/2+.2,'Newly retained particles enter beyond the visible edge');
   }
   previous=ids;
  }
  assert.deepEqual(continued.particleStates('stream',4,wide),extended,'Seeking does not change the continued stream');
 }
 const grouped=new Scene(fixture({rate:0,bursts:[{time:{frame:1,rate:{numerator:30,denominator:1}},count:1,sizeScale:.5,color:{r:1,g:0,b:0,a:1}}]}),'http://localhost/');
 grouped.setFrameTime(Time.fromDecimal(.999),rate);grouped.updateWorld();assert.equal(grouped.particleStates('stream').length,0);
 grouped.setFrameTime(Time.fromDecimal(1),rate);grouped.updateWorld();assert.equal(grouped.particleStates('stream')[0].age,0);
 assert.equal(grouped.particleStates('stream')[0].color.g,0);
 assert.throws(()=>new Scene(fixture({bursts:[{time:{frame:1.5,rate:{numerator:30,denominator:1}},count:1}]}),'http://localhost/'),/FrameNumber/);
 console.log('Asteroid data: atlas highlights/padding, chapter boundaries, fitted motion, rational bursts and viewport continuation passed.');
}
async function browserChecks(){
 fs.mkdirSync(out,{recursive:true});const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let glowReference;
 try{for(const [label,type,renderer]of [['dom',chromium,'dom'],['babylon',chromium,'babylon'],['firefox-dom',firefox,'dom']]){
  const browser=await type.launch(type===chromium?{executablePath:chromium.executablePath(),headless:true}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw Error('Canvas forbidden in DOM renderer');};});
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=2390`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=async f=>page.evaluate(async f=>{await scenePlayer.seekFrame(f,{numerator:30,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},f);
   const shot=()=>page.screenshot({style:'.runtime-loading-status {visibility:hidden!important}'});
   if(renderer==='dom'){
    const retained=await page.evaluate(async()=>{
     const art=document.querySelector('[data-entity="asteroid-background"] [data-role="tile-art"]');
     const geometry=()=>[...art.querySelectorAll('path')].map(p=>p.getAttribute('d')).join('');
     const before=geometry(),jobs=scenePlayer.resources.jobs.size;let pathWrites=0;
     const observer=new MutationObserver(changes=>pathWrites+=changes.filter(c=>c.attributeName==='d').length);
     observer.observe(art,{subtree:true,attributes:true});
     for(const f of [2391,2393,2395,2398,2390])await scenePlayer.seekFrame(f,{numerator:30,denominator:1});
     await scenePlayer.whenIdle();observer.disconnect();
     return {subpaths:(before.match(/M/g)||[]).length,sameGeometry:before===geometry(),pathWrites,jobsAdded:scenePlayer.resources.jobs.size-jobs};
    });
    assert(retained.subpaths<250,`Sparse star tiles must not expand to thousands of pixel rectangles: ${retained.subpaths}`);
    assert(retained.sameGeometry&&retained.pathWrites===0,'Background scrolling must retain its SVG geometry');
    assert.equal(retained.jobsAdded,0,'Particle motion/scale must reuse the prepared Gaussian masks');
   }
   const before=await shot();await page.evaluate(()=>window.retained=scenePlayer.renderer.objects.find(o=>o.id==='asteroid-orb-0'));
   for(const f of [2345,2398,2441,2443,2445,2460,2536,2390]){await seek(f);await page.screenshot({path:path.join(out,`${label}_${f}.png`),style:'.runtime-loading-status {visibility:hidden!important}'});}
   const replay=compare(before,await shot());assert(replay.mae<.001&&replay.max<=3,`${label}: deterministic reverse seek ${JSON.stringify(replay)}`);
   assert(await page.evaluate(()=>window.retained===scenePlayer.renderer.objects.find(o=>o.id==='asteroid-orb-0')));
   for(const size of [{width:1600,height:360},{width:360,height:800}]){
    await page.setViewportSize(size);await seek(2390);await page.screenshot({path:path.join(out,`${label}_${size.width}.png`),style:'.runtime-loading-status {visibility:hidden!important}'});
   }
   // Empty early starfield: portrait extension must show stars above and below
   // the central 16:9 crop, while toggling A restores exactly the source crop.
   await seek(2265);const portrait=png(await shot());
   const bright=(a,y0,y1)=>{let count=0;for(let y=y0;y<y1;y++)for(let x=0;x<a.width;x++)if(a.pixels[(y*a.width+x)*a.channels]>100)count++;return count;};
   assert(bright(portrait,0,260)>100&&bright(portrait,540,800)>100,'Vertical star tiles fill both portrait extensions');
   await page.keyboard.press('a');const constrained=png(await shot());assert.equal(bright(constrained,0,260),0);assert.equal(bright(constrained,540,800),0);await page.keyboard.press('a');
   await page.setViewportSize({width:640,height:360});
   const isolated=fixture({rate:0,bursts:[{time:0,count:1}],speed:{min:0,max:0},startSize:{min:.88,max:.88},animation:{mode:'single',frame:1},color:{r:0,g:1,b:1,a:1}}, {sigmaWorld:.03,intensity:1.8,threshold:0,softness:1,blend:'additive'});
   isolated.root.children[1].transform.localPosition.x=0;
   await page.evaluate(async d=>{await scenePlayer.loadScene(d);await scenePlayer.seek(.5);await scenePlayer.whenIdle();},isolated);
   const glowBuffer=await shot(),glow=png(glowBuffer);
   if(label==='dom')glowReference=glow;
   if(renderer==='dom'){
    const before=await page.evaluate(()=>scenePlayer.resources.jobs.size);
    await page.evaluate(async()=>{
     await scenePlayer.setComponent('stream','Glow',{color:{r:1,g:.5,b:1}});
     await scenePlayer.setComponent('stream','ParticleEmitter',{color:{r:1,g:0,b:0},startSize:{min:1,max:1}});
     await scenePlayer.whenIdle();
    });
    assert.equal(await page.evaluate(()=>scenePlayer.resources.jobs.size),before,'Tint and scale remain live CSS and reuse the same masks');
    const changedBuffer=await shot(),changed=png(changedBuffer),solid=pixel(changed,320,180);assert(solid[0]===255&&solid[1]===0,`CSS mask tint preserves opaque source pixels: ${solid}`);
    assert(compare(glowBuffer,changedBuffer).mae>1,'Runtime particle tint/scale edits must update the displayed result');
    await page.evaluate(async()=>{await scenePlayer.setComponent('stream','Glow',{sigmaWorld:.06});await scenePlayer.whenIdle();});
    assert(compare(changedBuffer,await shot()).mae>.1,'Changing the glow radius must invalidate its mask');
   }
   if(label==='babylon'){
    let sum=0,max=0,count=0;for(let y=70;y<290;y++)for(let x=210;x<430;x++)if(Math.hypot(x-320,y-180)>55){
     const d=Math.abs(pixel(glow,x,y)[1]-pixel(glowReference,x,y)[1]);sum+=d;max=Math.max(max,d);count++;
    }
    assert(sum/count<1.6&&max<20,`GPU glow must match the smooth DOM Gaussian halo: mean ${sum/count}, max ${max}`);
    const cached=await page.evaluate(async()=>{
     const o=scenePlayer.renderer.objects.find(o=>o.id==='stream'),filter=o.glowFilter,texture=filter.texture,count=filter.renderCount;
     await scenePlayer.seek(.6);await scenePlayer.setComponent('stream','Glow',{intensity:2.1});await scenePlayer.whenIdle();
     return o.glowFilter===filter&&filter.texture===texture&&filter.renderCount===count;
    });assert(cached,'Particle motion and glow gain reuse the filtered GPU atlas');
   }
   if(renderer==='dom')assert.equal(await page.locator('canvas').count(),0);
   assert.deepEqual(errors,[]);console.log(`${label}: playback, rewind, portrait/wide coverage, smooth glow and retained resources passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
numerical().then(browserChecks).catch(e=>{console.error(e);process.exitCode=1;});
