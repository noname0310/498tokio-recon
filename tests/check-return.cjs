const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),scene=new Scene(data,pathToFileURL(file).href),rate=frameRate(120);
 const at=n=>{scene.setFrameTime(Time.fromFrame(n*4),rate);scene.updateWorld();};
 for(const n of [3034.75,3035,3127.75,3128,3133.75,3134,3369.75,3370]){
  at(n);assert.equal(scene.cameraNode.id,n<3035?'destruction-camera':n<3134?'return-camera':'helmet-flat-camera');
  assert.equal(scene.nodes.has('return-moon-flight-root'),n>=3035&&n<3134);assert.equal(scene.nodes.has('return-side-flight-root'),n>=3128&&n<3370);
 }
 at(3054);assert.equal(scene.requireComponent('return-white-reveal','PlaneRenderer').color.a,1);
 at(3063);assert(Math.abs(scene.requireComponent('return-white-reveal','PlaneRenderer').color.a-.5)<1e-6);
 at(3072);assert.equal(scene.requireComponent('return-white-reveal','PlaneRenderer').color.a,0);
 const project=id=>{const w=scene.world.get(id),v=scene.viewMatrix,p=scene.projectCameraPoint({x:v[0]*w[12]+v[4]*w[13]+v[8]*w[14]+v[12],y:v[1]*w[12]+v[5]*w[13]+v[9]*w[14]+v[13],z:v[2]*w[12]+v[6]*w[13]+v[10]*w[14]+v[14]});return {x:320+p.x*100,y:180-p.y*100};};
 for(const [n,y]of [[3096,308.5],[3104,255],[3112,226],[3120,210],[3122,207]]){at(n);assert(Math.abs(project('return-rear-ship').y-y)<1,`Measured rear-ship center at ${n}`);assert(Math.abs(project('return-moon').x-320)<.01);assert(Math.abs(project('return-moon').y-180)<.01);}
 at(3072);const hue=scene.requireComponent('return-moon','SpriteRenderer').hueDegrees;at(3077.75);assert.equal(scene.requireComponent('return-moon','SpriteRenderer').hueDegrees,hue);at(3078);assert.notEqual(scene.requireComponent('return-moon','SpriteRenderer').hueDegrees,hue);
 at(3133.75);const before=project('return-side-ship');at(3134);const after=project('return-side-ship');assert(Math.hypot(before.x-after.x,before.y-after.y)<6,'The camera handoff preserves the incoming planar projection');
 for(const start of [3202,3239,3276]){const i=(start-3202)/37,id=`return-concentric-${i}`;at(start-.25);assert(!scene.isActive(id));at(start);assert(scene.isActive(id));at(start+10);const size=scene.transformAt(id).localScale.x;at(start+20);assert(scene.transformAt(id).localScale.x>size);at(start+30);assert(!scene.isActive(id));}
 at(3218);const world=JSON.stringify([...scene.world].filter(([id])=>id.startsWith('return-'))),stars=JSON.stringify(scene.particleStates('return-star-stream-3-0'));
 for(const n of [3350,3370,1500,3072,3218])at(n);assert.equal(JSON.stringify([...scene.world].filter(([id])=>id.startsWith('return-'))),world);assert.equal(JSON.stringify(scene.particleStates('return-star-stream-3-0')),stars,'Reverse seeks reproduce seeded star phases');
 const asset=data.assets.return_concentric_atlas,im=png(fs.readFileSync(path.join(root,'assets',asset.file))),stride=asset.atlas.cellSize.x+2;
 assert.equal(asset.atlas.frameCount,2);for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){const a=im.pixels[(y*im.width+x)*4+3];assert(a===0||a===255);if(y===0||y===im.height-1||x%stride===0||x%stride===stride-1)assert.equal(a,0,'Atlas gutters stay transparent');}
 console.log('Return flight: camera handoff, measured sparse path, held palette, independent pulses, binary atlas and deterministic reverse seek passed.');
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,shots=new Map();
 try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch(type===chromium?{headless:true,channel:'msedge'}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=3072`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=n=>page.evaluate(async n=>{await scenePlayer.seekFrame(n,{numerator:30,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},n);
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   for(const n of [3066,3096,3132,3134,3218,3248,3295]){await seek(n);shots.set(`${name}/${n}`,await shot());}
   await seek(3218);const first=await shot();await seek(3370);await seek(3072);await seek(3218);assert(compare(first,await shot()).mae<.002,`${name}: the full flash/particle scene survives reverse seeks`);
   for(const size of [{width:360,height:780},{width:1280,height:360}]){
    await page.setViewportSize(size);await seek(3054);const white=png(await shot());for(let i=0;i<white.pixels.length;i+=white.channels)assert(white.pixels[i]>253,`${name}: white reveal covers the expanded viewport`);
    await seek(3369);const black=png(await shot());for(let i=0;i<black.pixels.length;i+=black.channels)assert(black.pixels[i]<2,`${name}: final fade covers the expanded viewport`);
   }
   if(renderer==='dom')assert.equal(await page.locator('canvas').count(),0);
   assert.deepEqual(errors,[]);console.log(`${name}: return-flight compositing, seek and dynamic-aspect coverage passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
 for(const n of [3066,3096,3132,3134,3218,3248,3295]){const edge=compare(shots.get(`dom/${n}`),shots.get(`babylon/${n}`)),ff=compare(shots.get(`dom/${n}`),shots.get(`firefox-dom/${n}`));assert(edge.mae<7,`DOM/Babylon parity at ${n}: ${JSON.stringify(edge)}`);assert(ff.mae<7,`DOM/Firefox parity at ${n}: ${JSON.stringify(ff)}`);}
 console.log('Return-flight renderer comparisons passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
