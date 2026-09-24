const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),scene=new Scene(data,pathToFileURL(file).href);
 const at=n=>{scene.setFrameTime(Time.fromDecimal(n),frameRate(30));scene.updateWorld();};
 for(const n of [3430,3431,3504,3707.99,3708,4041.99,4042,4050].reverse()){
  at(n);assert.equal(scene.nodes.has('flashback-children-root'),n>=3431&&n<3708);assert.equal(scene.nodes.has('flashback-meeting-root'),n>=3708&&n<4042);
 }
 for(const [n,frame]of [[3503,2],[3504,6],[3523.999,6],[3524,4],[3532,0],[3603,4],[3653,0]]){at(n);assert.equal(scene.spriteState('flashback-child-0-body').frame,frame,`Child pose at ${n}`);}
 at(3504);assert(Math.abs(scene.world.get('flashback-child-0')[12]+.26)<.001);
 at(3577);assert(Math.abs(scene.world.get('flashback-child-1')[12]+.8779)<.001);
 for(const [n,frame]of [[3776,1],[3777,4],[3879.999,4],[3880,6]]){at(n);assert.equal(scene.spriteState('flashback-adult').frame,frame);}
 at(3910);assert.equal(scene.requireComponent('flashback-ship-pilot','SpriteRenderer').asset,'pilot_red');assert.equal(scene.requireComponent('flashback-blue-ship','SpriteRenderer').asset,'flight_ship');
 at(3939.999);assert.equal(scene.requireComponent('helmet-flat-camera','ViewportTransform').enabled,false);
 at(3940);assert.equal(scene.requireComponent('helmet-flat-camera','ViewportTransform').enabled,true);
 at(3500);assert.equal(scene.requireComponent('helmet-flat-camera','ColorGrade').strength,0,'Rewind restores camera effects');
 for(const s of ['flashback-children','flashback-meeting'])for(const binding of data.animation.sequences[s].bindings){
  if(binding.property.path==='localPosition.x')assert(data.animation.tracks[binding.track].frameNumber.length<=6,'Movement uses sparse linear segments');
 }
 const fixture={schemaVersion:1,root:{id:'root',children:[{id:'camera',transform:{localPosition:{z:-10}},components:[
  {type:'Camera',referenceVerticalSize:3.6,clearColor:{r:.2,g:.4,b:.8,a:1}},
  {type:'ColorGrade',matrix:[1,0,0,.2,0,1,0,-.1,0,0,.5,0],midpoint:{r:.75,g:.25,b:.5},strength:.75},
  {type:'ViewportTransform',scale:.5,centerViewport:{x:.6,y:.4},opacity:.8}
 ]}]}};
 // Validation protects dynamically loaded JSON, including components without
 // a camera and malformed coefficient arrays.
 for(const mutate of [x=>x.root.children[0].components[1].matrix.pop(),x=>x.root.children[0].components[2].scale=-1,x=>x.root.children[0].components[1].strength=2,x=>x.root.children[0].components.shift()]){
  const invalid=structuredClone(fixture);mutate(invalid);assert.throws(()=>new Scene(invalid,'http://localhost/scene.json'));
 }
 console.log('Flashback: native-grid positions, exact poses, sparse paths, ownership and effect validation passed.');
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [label,type,renderer]of [['Edge DOM',chromium,'dom'],['Firefox DOM',firefox,'dom'],['Babylon',chromium,'babylon']]){
  const browser=await type.launch(type===chromium?{headless:true,channel:'msedge'}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=3940`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const settle=()=>page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const seek=n=>page.evaluate(async n=>{await scenePlayer.seekFrame(n,{numerator:30,denominator:1});await scenePlayer.whenIdle();},n);
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   await settle();const first=await shot();
   for(const n of [4050,3504,3603,3708,3777,3798,3880,3940])await seek(n);
   await settle();assert(compare(first,await shot()).mae<.002,`${label}: deterministic rewind`);
   await page.evaluate(f=>scenePlayer.loadScene(f),fixture);await settle();
   for(const size of [{width:640,height:360},{width:390,height:844},{width:1440,height:400}]){
    await page.setViewportSize(size);await page.waitForFunction(s=>scenePlayer.view.width===s.width&&scenePlayer.view.height===s.height,size);await settle();
    const r=await page.locator('#viewport').boundingBox();assert(Math.abs(r.width-size.width*.5)<.02);assert(Math.abs(r.height-size.height*.5)<.02);assert(Math.abs(r.x-size.width*.35)<.02);assert(Math.abs(r.y-size.height*.35)<.02);
    const im=png(await shot()),x=Math.round(size.width*.6),y=Math.round(size.height*.6),p=(y*im.width+x)*im.channels;
    for(const [i,v]of [102,43.35,102].entries())assert(Math.abs(im.pixels[p+i]-v)<2,`${label}: camera grading and opacity ${Array.from(im.pixels.subarray(p,p+3))}`);
    assert.equal(im.pixels[0],0,'Outside the shrunken viewport stays black');
   }
   await page.evaluate(()=>scenePlayer.setReferenceAspect(true));await settle();const box=await page.locator('#viewport').boundingBox();assert(Math.abs(box.width/box.height-16/9)<.001);
   if(renderer==='dom'){
    assert.equal(await page.locator('canvas').count(),0);
    const writes=await page.evaluate(async()=>{const o=new MutationObserver(()=>{});o.observe(scenePlayer.viewport,{attributes:true,childList:true,subtree:true});await scenePlayer.update();const count=o.takeRecords().length;o.disconnect();return count;});assert.equal(writes,0,'Unchanged filters and viewport reuse existing DOM');
   }
   await page.evaluate(async()=>{await scenePlayer.setComponent('camera','ViewportTransform',{enabled:false});await scenePlayer.setComponent('camera','ColorGrade',{enabled:false});});await settle();
   const reset=await page.evaluate(()=>({filter:scenePlayer.viewport.style.filter,transform:scenePlayer.viewport.style.transform,opacity:scenePlayer.viewport.style.opacity}));assert.equal(reset.transform,'none');assert.equal(reset.opacity,'1');if(renderer==='dom')assert.equal(reset.filter,'none');
   assert.deepEqual(errors,[]);console.log(`${label}: sRGB grade, viewport scaling, portrait/ultrawide, letterbox, rewind and filter bypass passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
