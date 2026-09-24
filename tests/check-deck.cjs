const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright');
const {makeServer,root}=require('./serve.cjs');
const {png,compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
const out=path.join(root,'test-results/deck');
async function main(){
 const {Scene,Time,frameRate,Math3D}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
 const scene=new Scene(data,pathToFileURL(file).href),rate=frameRate(30);
 const at=n=>{scene.setFrameTime(Time.fromDecimal(n),rate);scene.updateWorld();};
 for(const n of [2536.999,2537,2582,2610.999,2611,2537]){
  at(n);const active=n>=2537&&n<2611;
  assert.equal(scene.nodes.has('deck-scene'),active);assert.equal(scene.nodes.has('deck-background'),active);
  assert.equal(scene.cameraNode.id,active?'deck-camera':n>=2611?'boss-camera':'helmet-flat-camera');
 }
 at(2570);assert.equal(scene.requireComponent('deck-camera','Camera').projection,'perspective');
 assert.equal(scene.parents.get('deck-background').id,'deck-camera');
 assert.equal(scene.requireComponent('deck-missile-0','SpriteRenderer').asset,'asteroid_missile');
 assert.equal(scene.requireComponent('deck-ship','SpriteRenderer').asset,'asteroid_ship');
 assert.equal(scene.requireComponent('deck-pilot','SpriteRenderer').asset,'helmet_pilot_blue');
 assert(Math.abs(scene.transformAt('deck-pilot').localPosition.z)<.001,'The seated pilot is nearly coplanar with the hull');
 const basis=data.reconstruction.deckPass.worldBasis.floorToWorldRotation;
 const floorYaw=()=>{
  const m=scene.world.get('deck-camera'),forward=[m[8],m[9],m[10]];
  const floorForward=[0,1,2].map(j=>basis.reduce((sum,row,i)=>sum+row[j]*forward[i],0));
  return Math.atan2(floorForward[0],floorForward[2])*180/Math.PI;
 };
 const deck=data.animation.sequences['deck-pass'],hullBindings=deck.bindings.filter(b=>b.object==='deck-ship'&&b.property.component==='Transform');
 assert.equal(hullBindings.length,3,'Only X/Y/Z position tracks animate the hull');
 for(const b of hullBindings){
  assert(/^localPosition\.[xyz]$/.test(b.property.path));assert(!b.blend||b.blend==='replace','No additive hull correction');
  assert.deepEqual(data.animation.tracks[b.track].frameNumber,[0,14,73],'Exactly three position keys, at 2537, 2551 and 2610');
 }
 at(2537);const floorMatrix=[...scene.world.get('deck-floor')],firstYaw=floorYaw();
 let previousYaw=firstYaw;
 for(let n=2537;n<=2610;n++){
  at(n);for(const [id,m]of scene.world)assert(m.every(Number.isFinite),`${id}: finite transform at ${n}`);
  assert.deepEqual(scene.world.get('deck-floor'),floorMatrix,'Camera motion must not move the floor');
  assert.deepEqual(scene.transformAt('deck-ship').localRotation,{x:0,y:0,z:0},'The hull has no authored or animated rotation');
  const shipWorld=scene.world.get('deck-ship');for(const index of [1,2,4,6,8,9])assert(Math.abs(shipWorld[index])<1e-10,'A rotated parent must not conceal hull rotation');
  const yaw=floorYaw();assert(yaw<=previousYaw+1e-4,'The recovered turn must not reverse');previousYaw=yaw;
 }
 assert(firstYaw-previousYaw>100&&firstYaw-previousYaw<115,'Both ends of the measured heading constrain the turn');
 const heading=data.animation.tracks['deck-camera-Transform-localRotation-y'];
 assert(heading.frameNumber.length<20,'Main heading uses a fitted curve, not one key per source frame');
 assert(scene.isActive('deck-ship'),'The receding ship still exists at frame 2610');
 const hull=scene.asset('asteroid_ship'),nose={x:-hull.pivot.x*.78,y:(1-hull.pivot.y)*.30-.24,z:0};
 const cameraNose=Math3D.point(scene.viewMatrix,Math3D.point(scene.world.get('deck-ship'),nose));
 const projected=scene.projectCameraPoint(cameraNose),x=320+projected.x*100,y=180-projected.y*100;
 assert(x>78&&x<98&&y>155&&y<180,`The final hull stays near the observed left-edge speck: ${x}, ${y}`);
 const shipScale=[...Object.values(scene.transformAt('deck-ship').localScale)];
 for(const n of [2540,2542,2545,2583,2610]){at(n);assert.deepEqual(Object.values(scene.transformAt('deck-ship').localScale),shipScale,'Apparent size comes from 3D distance, not scale animation');}
 for(const n of [2537,2540.5,2549.75,2551,2557.25,2583.5,2610]){
  at(n);const p=scene.transformAt('deck-ship').localPosition;
  assert(Object.values(p).every(Number.isFinite),'The fitted position curve remains finite between source frames');
  assert.deepEqual(scene.world.get(scene.parents.get('deck-ship').id),Math3D.identity(),'No animated parent supplies extra hull motion');
 }
 const unwrap=data.reconstruction.deckPass.camera.tileUnwrap;
 assert.deepEqual(unwrap.selected.tiles,[0,0],'The second floor track uses the visually confirmed Z +1 correction');
 assert.deepEqual(unwrap.confirmedPreviewOffset,[0,1]);
 assert(unwrap.alternatives.some(c=>c.distance<unwrap.selected.distance),'Minimum endpoint distance alone cannot determine tile phase');
 assert(scene.requireComponent('deck-ship','SortingGroup').enabled);
 assert(scene.requireComponent('deck-pilot','SpriteRenderer').sortingOrder<scene.requireComponent('deck-ship','SpriteRenderer').sortingOrder,'The seated pilot draws behind the hull');
 // Screen size alone admits different metric depths. The exposed hull in
 // these source frames constrains the early explosions to its far side;
 // the later close impact must still cover the hull in the opposite order.
 const depth=id=>Math3D.point(scene.viewMatrix,scene.spriteSortAnchor(id)||Math3D.point(scene.world.get(id),{x:0,y:0,z:0})).z;
 for(let n=2565;n<=2580;n++){
  at(n);
  for(const id of ['deck-impact-0','deck-impact-1','deck-impact-2'])if(scene.isActive(id))assert(depth(id)>depth('deck-ship'),`${n}: ${id} must lie behind the visible hull`);
 }
 at(2582);assert(depth('deck-beam-11')>depth('deck-ship'),'The near green ray passes behind the hull at 2582');
 at(2580);assert(depth('deck-beam-9')>depth('deck-ship'),'The fading diagonal ray also passes behind the exposed hull');
 at(2583);assert(depth('deck-impact-3')<depth('deck-ship'),'The close explosion still occludes the hull at 2583');
 at(2540);const entry=scene.requireComponent('deck-ship','SpriteMotionBlur');
 assert(entry.translationWorld.y<-.08,'The entering hull has the measured directional exposure');
 assert(Math.abs(scene.requireComponent('deck-pilot','SpriteMotionBlur').translationWorld.x+entry.translationWorld.x)<1e-6,'The mirrored pilot shares the hull blur direction');
 const initialBlur=Math.hypot(entry.translationWorld.x,entry.translationWorld.y);
 at(2544);const ending=scene.requireComponent('deck-ship','SpriteMotionBlur');assert(Math.hypot(ending.translationWorld.x,ending.translationWorld.y)<initialBlur);
 at(2545);assert.equal(scene.requireComponent('deck-ship','SpriteMotionBlur').translationWorld.y,0,'Entry exposure ends without blurring the remaining chapter');
 const lasers=[...scene.nodes.values()].filter(n=>/^deck-beam-\d+$/.test(n.id));
 assert.equal(lasers.length,16,'Continuous source lasers exclude duplicate edges and sprite highlights');
 for(const node of lasers)assert.equal(scene.requireComponent(node.id,'LineRenderer').coverage,'ray');
 // Measured source core centres at the beginning, middle and end of each
 // selected laser. Check actual evaluated 3D projections, not fitted metadata.
 const beamObservations={
  0:[[2547,487.92,102.5],[2552,492.32,106.5],[2557,503.35,110.9]],
  1:[[2549,576.52,52.5],[2554,589.58,46.5],[2559,590.96,44.5]],
  5:[[2563,549.23,39.06],[2568,568.03,33.5],[2572,590.97,20.5]],
  6:[[2565,454.24,110.5],[2570,470.67,81.69],[2574,509.59,94.7]],
  9:[[2575,481.92,114.5],[2578,507.39,78.02],[2580,527.09,53.75]],
  11:[[2580,456.02,137.5],[2583,527.65,130.45],[2585,549.39,33.5]],
  14:[[2593,69.29,107.53],[2598,105.55,94.89],[2603,125.29,87.96]],
  15:[[2595,27.93,45.5],[2599,51.45,66.5],[2603,72.03,61.81]]
 };
 for(const [index,observations]of Object.entries(beamObservations))for(const [n,x,y]of observations){
  at(n);const id=`deck-beam-${index}`,line=scene.requireComponent(id,'LineRenderer'),matrix=Math3D.multiply(scene.viewMatrix,scene.world.get(id));
  const p=[line.start,line.end].map(q=>{const c=scene.projectCameraPoint(Math3D.point(matrix,{...q,z:0}));return {x:320+c.x*100,y:180-c.y*100};});
  const dx=p[1].x-p[0].x,dy=p[1].y-p[0].y,error=Math.abs(dx*(y-p[0].y)-dy*(x-p[0].x))/Math.hypot(dx,dy);
  assert(error<5,`${id} at ${n}: multi-frame source projection differs by ${error}px`);
  assert(scene.isActive(id));assert(line.width>0&&Number.isFinite(line.width));
 }
 let previousCamera=null;
 for(let n=2578;n<=2594;n++){
  at(n);const camera=scene.world.get('deck-camera').slice(12,15);
  if(previousCamera)assert(Math.hypot(...camera.map((v,i)=>v-previousCamera[i]))<5,`The camera must not jump to compensate for the hull at ${n}`);
  previousCamera=camera;
 }
 at(2550);
 const floorInverse=Math3D.inverse(scene.world.get('deck-floor'));
 for(const node of scene.nodes.values())if(node.id.startsWith('deck-beam-')&&scene.isActive(node.id)){
  const line=scene.requireComponent(node.id,'LineRenderer'),matrix=scene.world.get(node.id),a=Math3D.point(matrix,{...line.start,z:0}),b=Math3D.point(matrix,{...line.end,z:0});
  assert(Math3D.point(floorInverse,a).z*Math3D.point(floorInverse,b).z<0,`${node.id}: geometry crosses the floor instead of ending at a screen boundary`);
 }
 for(const start of [2551,2564,2574,2583,2595]){
  const id=`deck-impact-${[2551,2564,2574,2583,2595].indexOf(start)}`;
  at(start-.001);assert(!scene.isActive(id));at(start);assert(scene.isActive(id));assert.equal(scene.spriteState(id).frame,0);
  at(start+5.999);assert.equal(scene.spriteState(id).frame,5);at(start+6);assert.equal(scene.spriteState(id).frame,6);
 }
 for(const [frame,points]of [
  [2583,[[388.5,342.5],[389.5,345.5],[477.5,349.5]]],
  [2588,[[58.5,280.5],[178.5,306.5],[281.5,328.5],[389.5,354.5]]],
  [2594,[[236.5,308.5],[269.5,318.5],[321.5,330.5]]]
 ]){
 at(frame);
 const impactMatrix=scene.world.get('deck-impact-3'),impactToFloor=Math3D.multiply(Math3D.inverse(scene.world.get('deck-floor')),impactMatrix);
 const contact=[-.2,.2].map(x=>{
  const y=-(impactToFloor[2]*x+impactToFloor[14])/impactToFloor[6];
  const point=scene.projectCameraPoint(Math3D.point(scene.viewMatrix,Math3D.point(impactMatrix,{x,y,z:0})));
  return {x:320+point.x*100,y:180-point.y*100};
 });
 const slope=(contact[1].y-contact[0].y)/(contact[1].x-contact[0].x),intercept=contact[0].y-slope*contact[0].x;
 for(const [x,y]of points)assert(Math.abs(slope*x+intercept-y)<4,`${frame}: source explosion/floor intersection at ${x}`);
 }
 const a=data.assets.deck_impact_atlas,im=png(fs.readFileSync(path.join(root,'assets',a.file))),stride=a.atlas.cellSize.x+2;
 assert.equal(im.channels,4);assert.deepEqual([im.width,im.height],[a.size.x,a.size.y]);
 for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++)if(y===0||y===im.height-1||x%stride===0||x%stride===stride-1)assert.equal(im.pixels[(y*im.width+x)*4+3],0,'Transparent atlas gutter');
 console.log('Deck data: camera cuts, chapter ownership, asset reuse, exact atlas ticks and padding passed.');
 fs.mkdirSync(out,{recursive:true});const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const cases=process.argv.includes('--edge')?[['edge-dom',chromium,'dom','msedge']]:[['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']];
 try{for(const [name,type,renderer,channel]of cases){
  const browser=await type.launch(channel?{headless:true,channel}:type===chromium?{headless:true,executablePath:chromium.executablePath()}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=2570`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=n=>page.evaluate(async n=>{await scenePlayer.seekFrame(n,{numerator:30,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},n);
   const shot=()=>page.screenshot({style:'.runtime-loading-status {visibility:hidden!important}'});
   // Capture both sides of a rewind after the same explicit seek/presentation
   // boundary; initial progressive preparation may still be presenting a frame.
   await seek(2570);const first=await shot();
   if(renderer==='dom'){
    // A moving camera must retain the native tile and the authored crop.
    // Rebuilding repeated paths or moving that crop invalidates a large
    // perspective raster surface even when the source texture is unchanged.
    await page.evaluate(()=>{
     const floor=document.querySelector('[data-entity="deck-floor"]'),art=floor.querySelector('[data-role="tile-art"]');
     const crop=document.getElementById(art.id+'-crop');
     window.floorRaster={art,paths:[...art.children],mutations:0};
     window.floorRasterObserver=new MutationObserver(records=>window.floorRaster.mutations+=records.length);
     window.floorRasterObserver.observe(art,{subtree:true,attributes:true,childList:true});
     window.floorRasterObserver.observe(crop,{subtree:true,attributes:true,childList:true});
    });
    for(let n=5141;n<=5148;n++)await page.evaluate(async n=>{await scenePlayer.seekFrame(n,{numerator:60,denominator:1});await scenePlayer.whenIdle();},n);
    const retained=await page.evaluate(()=>{window.floorRasterObserver.disconnect();const f=window.floorRaster;return {mutations:f.mutations,connected:f.art.isConnected&&f.paths.every(p=>p.parentNode===f.art),uses:document.querySelector('[data-entity="deck-floor"]').querySelectorAll('use').length};});
    assert(retained.connected,'Camera movement retains the same native tile nodes');
    assert.equal(retained.mutations,0,'Native artwork and the authored clip remain cached during camera motion');
    assert.equal(retained.uses,0,'An oblique floor must not expand each repeat into a separate SVG row');
   }
   for(const n of [2537,2540,2542,2545,2557,2570,2580,2581,2582,2583,2588,2594,2604,2610]){
    await seek(n);const image=await shot();fs.writeFileSync(path.join(out,`${name}_${n}.png`),image);
    if(renderer==='dom'){
     const mask=await page.evaluate(()=>{
      const p=scenePlayer,css=document.querySelector('[data-entity="deck-floor"]').style.clipPath,b=p.scene.component(p.scene.cameraNode.id,'GaussianBlur');
      return {css,width:p.view.width,height:p.view.height,padding:b?.enabled?4*Math.max(b.sigmaWorld.x,b.sigmaWorld.y)*p.view.pixelsPerUnit:0};
     });
     if(mask.css.startsWith('polygon(')){
      const xy=[...mask.css.matchAll(/(-?[\d.e+]+)px/g)].map(m=>Number(m[1]));
      assert(xy.length>=6&&xy.length%2===0,'A visible floor has a nonempty projected mask');
      xy.forEach((value,i)=>assert(Math.abs(value)<=(i%2?mask.height:mask.width)/2+mask.padding+.02,'Perspective masks stay within the viewport and blur overscan'));
     }
    }
    if(n===2570||n===2604){
     const p=png(image);let floor=0,total=0;
     for(let y=330;y<358;y++)for(let x=190;x<450;x++){
      const i=(y*p.width+x)*p.channels,[r,g,b]=p.pixels.subarray(i,i+3);total++;if(r>90&&g>85&&r>b+20&&Math.abs(r-g)<30)floor++;
     }
     assert(floor/total>.9,`${name}: oblique floor must remain in front of the camera backdrop at ${n}`);
    }
    if(n===2588){
     const p=png(image);let clipped=0;
     for(const x of [80,120,160,200,240,280,320]){
      const y=Math.round(.22462438*x+266.70239+7),i=(y*p.width+x)*p.channels,[r,g,b]=p.pixels.subarray(i,i+3);
      if(r>55&&Math.abs(r-g)<35&&b>r*.45)clipped++;
     }
     assert(clipped>=6,`${name}: the near explosion is hidden below the measured floor contact (${clipped}/7)`);
    }
    if(n===2570){
     const p=png(image);let hullPixels=0;
     for(let y=125;y<160;y++)for(let x=580;x<606;x++){
      const i=(y*p.width+x)*p.channels,[r,g,b]=p.pixels.subarray(i,i+3);
      if(Math.min(r,g,b)>30&&Math.max(r,g,b)-Math.min(r,g,b)<70)hullPixels++;
     }
     assert(hullPixels>=12,`${name}: the far explosion must not hide the exposed source hull (${hullPixels} neutral hull pixels)`);
    }
    const hullObservations={2540:{roi:[446,5,486,60],center:[465.4,31.85],sigma:9.15},2542:{roi:[483,78,515,118],center:[497.56,95.57],sigma:6.55},2545:{roi:[509,119,532,151],center:[518.65,134.95],sigma:5.92},2610:{roi:[80,145,105,177],center:[90.11,163.51],sigma:4.32}};
    if(hullObservations[n]){
     const p=png(image),o=hullObservations[n],samples=[];
     for(let y=o.roi[1];y<o.roi[3];y++)for(let x=o.roi[0];x<o.roi[2];x++){
      const i=(y*p.width+x)*p.channels,[r,g,b]=p.pixels.subarray(i,i+3);
      if(Math.min(r,g,b)>12&&Math.max(r,g,b)-Math.min(r,g,b)<65)samples.push([x,y,(r+g+b)/3]);
     }
     assert(samples.length>=4,`${name}: exposed ship is visible at ${n}`);
     const weight=samples.reduce((a,s)=>a+s[2],0),cx=samples.reduce((a,s)=>a+s[0]*s[2],0)/weight,cy=samples.reduce((a,s)=>a+s[1]*s[2],0)/weight;
     const xx=samples.reduce((a,s)=>a+(s[0]-cx)**2*s[2],0)/weight,yy=samples.reduce((a,s)=>a+(s[1]-cy)**2*s[2],0)/weight,xy=samples.reduce((a,s)=>a+(s[0]-cx)*(s[1]-cy)*s[2],0)/weight;
     const sigma=Math.sqrt((xx+yy+Math.hypot(xx-yy,2*xy))/2);
     assert(Math.hypot(cx-o.center[0],cy-o.center[1])<3,`${name}: source hull centroid at ${n}: ${cx}, ${cy}`);
     assert(sigma>o.sigma*.65&&sigma<o.sigma*1.4,`${name}: source apparent hull size at ${n}: ${sigma}`);
    }
   }
   await seek(2570);const rewound=await shot(),rewind=compare(first,rewound);if(rewind.mae>=.001){fs.writeFileSync(path.join(out,`${name}_initial.png`),first);fs.writeFileSync(path.join(out,`${name}_rewind.png`),rewound);}assert(rewind.mae<.001,`${name}: deterministic seek ${JSON.stringify(rewind)}`);
   for(const size of [{width:360,height:800},{width:1280,height:320}]){
    await page.setViewportSize(size);await seek(2570);await page.screenshot({path:path.join(out,`${name}_${size.width}.png`),style:'.runtime-loading-status {visibility:hidden!important}'});
    if(renderer==='dom')assert.equal(await page.locator('canvas').count(),0);
   }
   assert.deepEqual(errors,[]);console.log(`${name}: visible perspective floor, repeat seek, portrait and ultrawide passed.`);
  }finally{await browser.close();}
 }}finally{server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
