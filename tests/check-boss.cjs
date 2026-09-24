const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium,firefox}=require('playwright');
const {makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
 const scene=new Scene(data,pathToFileURL(file).href),rate=frameRate(30),at=n=>{scene.setFrameTime(Time.fromDecimal(n),rate);scene.updateWorld();};
 for(const n of [2610.999,2611,2639,2684.999,2685,2685.999,2686,2611]){
  at(n);assert.equal(scene.nodes.has('boss-scene'),n>=2611&&n<2686);
  assert.equal(scene.isActive('boss-hull'),n>=2611&&n<2685);
  if(n>=2611&&n<2686)assert.equal(scene.cameraNode.id,'boss-camera');
 }
 at(2640);const cylinder=scene.requireComponent('boss-background','CylindricalSpriteRenderer');
 assert.equal(cylinder.asset,'asteroid_background_tile');assert.equal(cylinder.segments,100);
 const tile=png(fs.readFileSync(path.join(root,'assets/asteroid_field/background_tile.png'))),points=[];
 assert.equal(tile.width,100);assert.equal(tile.height,100);
 for(let y=0;y<100;y++)for(let x=0;x<100;x++){const offset=(y*100+x)*tile.channels;if(tile.pixels[offset]){assert.equal(tile.pixels[offset],189);points.push([x,y]);}}
 assert.deepEqual(points.filter(p=>p[1]<72),[[34,2],[77,4],[42,22],[6,27],[22,39],[52,41],[90,54],[42,63],[11,70]],'The observed original crop is unchanged');
 assert.deepEqual(points.filter(p=>p[1]>=72),[[67,87],[23,88],[0,91]],'The axial repeat supplies three additional stars');
 const bs=data.animation.sequences['boss-arrival'];
 for(const b of bs.bindings.filter(b=>b.object==='boss-hull'&&b.property.component==='Transform'))assert.deepEqual(data.animation.tracks[b.track].frameNumber,[0,17,25,73]);
 for(let n=2611;n<2685;n+=.25){at(n);assert.deepEqual(scene.transformAt('boss-hull').localRotation,{x:0,y:0,z:0});assert.deepEqual(scene.transformAt('boss-hull').localScale,{x:1,y:1,z:1});assert(scene.transformAt('boss-hull').localPosition.z>0);const b=scene.requireComponent('boss-hull','SpriteMotionBlur');assert(b.radialAmount>=-1e-6&&b.radialAmount<=.95);}
 for(const [i,start]of [2639,2644,2648,2653,2657,2662,2666].entries()){
  at(start-.001);assert(!scene.isActive(`boss-beam-${i}`));at(start);assert(scene.isActive(`boss-beam-${i}`));assert.equal(scene.spriteState(`boss-ring-${i}`).frame,0);
  at(start+1);assert.equal(scene.spriteState(`boss-ring-${i}`).frame,1);at(start+6);assert(!scene.spriteState(`boss-ring-${i}`).visible);at(start+10);assert(!scene.isActive(`boss-beam-${i}`));
 }
 const invalid=structuredClone(data);invalid.animation.sequences['boss-arrival'].objects[0].template.children[0].components[0].segments=2;
 assert.throws(()=>new Scene(invalid,pathToFileURL(file).href),/segments/);
 const out=path.join(root,'test-results/boss');fs.mkdirSync(out,{recursive:true});
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true,...type===chromium?{executablePath:chromium.executablePath()}:{}});try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=2640`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=n=>page.evaluate(async n=>{await scenePlayer.seekFrame(n*4,{numerator:120,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},n);
   const shot=()=>page.screenshot({style:'.runtime-loading-status {visibility:hidden!important}'});
   await seek(2640);const initial=await shot();fs.writeFileSync(path.join(out,`${name}_2640.png`),initial);
   // Independent centres measured in the source footage, including the new U67 star.
   const stars=[[174.69,17.44],[348.09,54.62],[581.77,205.52],[403.88,345.97]],im=png(initial);
   for(const [cx,cy]of stars){let peak=0;for(let y=Math.floor(cy)-3;y<=Math.ceil(cy)+3;y++)for(let x=Math.floor(cx)-3;x<=Math.ceil(cx)+3;x++)if(x>=0&&x<640&&y>=0&&y<360){const offset=(y*640+x)*im.channels;peak=Math.max(peak,Math.min(...im.pixels.subarray(offset,offset+3)));}assert(peak>25,`${name}: cylindrical projection at source star ${cx}, ${cy}`);}
   await page.evaluate(()=>{
    const r=scenePlayer.renderer,o=r.objects.find(o=>o.id==='boss-background');window.retainedCylinder={o,nodes:[...document.querySelectorAll('[data-entity="boss-background"]')],uploads:0,added:0};
    if(o.mesh){const set=o.mesh.setVerticesData.bind(o.mesh);o.mesh.setVerticesData=(...args)=>{window.retainedCylinder.uploads++;return set(...args);};}
    window.cylinderObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof Element&&node.matches('[data-entity="boss-background"]'))window.retainedCylinder.added++;});window.cylinderObserver.observe(document.body,{subtree:true,childList:true});
   });
   for(const n of [2640.25,2641,2646,2668,2684,2633,2611,2640])await seek(n);
   const retained=await page.evaluate(()=>{const x=window.retainedCylinder;window.cylinderObserver.disconnect();return {same:scenePlayer.renderer.objects.find(o=>o.id==='boss-background')===x.o,nodes:x.nodes.every(n=>n.isConnected),count:x.nodes.length,uploads:x.uploads,added:x.added};});
   assert(retained.same&&retained.nodes);assert.equal(retained.uploads,0,'UV scrolling must not upload vertex buffers');assert.equal(retained.added,0,'UV scrolling must reuse DOM facets');if(renderer==='dom'){assert.equal(retained.count,100);assert.equal(await page.locator('canvas').count(),0);}
   const replayDifference=compare(initial,await shot());assert(replayDifference.mae<.001,`${name}: deterministic cylinder and weapons after seek: ${JSON.stringify(replayDifference)}`);
   await seek(2633);
   const spriteBounds=await page.evaluate(async()=>{
    const p=scenePlayer,s=p.scene,{Math3D:M}=await import('/runtime/player.js');
    s.active.set('boss-background',false);
    const a=s.asset('boss_capital_ship'),matrix=M.multiply(s.viewMatrix,s.world.get('boss-hull'));
    const corners=[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>{const c=s.projectCameraPoint(M.point(matrix,{x:(x-a.pivot.x)*a.size.x/a.pixelsPerUnit,y:(y-a.pivot.y)*a.size.y/a.pixelsPerUnit,z:0}));return [320+c.x*p.view.pixelsPerUnit,180-c.y*p.view.pixelsPerUnit];});
    await p.renderer.update(s,p.view);return [Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))];
   });
   const outside=buffer=>{const p=png(buffer),[left,top,right,bottom]=spriteBounds;let count=0;for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)if(x<left-2||x>right+2||y<top-2||y>bottom+2){const j=(y*p.width+x)*p.channels;if(Math.max(...p.pixels.subarray(j,j+3))>10)count++;}return count;};
   assert.equal(outside(await shot()),0,`${name}: zoom exposure is clipped to the original rectangle`);
   await page.evaluate(async()=>{const p=scenePlayer;p.scene.requireComponent('boss-hull','SpriteMotionBlur').clipToSprite=false;await p.renderer.update(p.scene,p.view);});
   assert(outside(await shot())>100,`${name}: unclipped motion remains available to other scenes`);
   for(const size of [{width:360,height:800},{width:1280,height:320}]){
    await page.setViewportSize(size);await seek(2646);const image=await shot();fs.writeFileSync(path.join(out,`${name}_${size.width}.png`),image);
    if(size.width===360){const p=png(image);let beam=0;for(let y=780;y<799;y++)for(let x=0;x<360;x++){const j=(y*360+x)*p.channels;if(p.pixels[j+1]>80&&p.pixels[j+1]>p.pixels[j]*1.3)beam++;}assert(beam>15,`${name}: portrait rays reach the viewport edge`);}
   }
   await page.setViewportSize({width:640,height:360});await seek(2685);const black=png(await shot());assert([...black.pixels].every((v,i)=>i%black.channels===3||v===0),`${name}: the exact black frame is 2685`);
   await seek(2686);assert.equal(await page.locator('[data-entity="boss-background"]').count(),0);assert(!await page.evaluate(()=>scenePlayer.renderer.objects.some(o=>o.id==='boss-background')));
   await seek(2640);assert(compare(initial,await shot()).mae<.001,`${name}: chapter re-entry`);assert.deepEqual(errors,[]);
   console.log(`${name}: source star centres, retained facets/GPU buffers, rewind, aspect expansion and chapter boundaries passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
