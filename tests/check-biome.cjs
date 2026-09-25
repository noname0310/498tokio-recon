const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
const output=path.join(root,'test-results/biome');fs.mkdirSync(output,{recursive:true});
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),scene=new Scene(data,pathToFileURL(file).href);
 const at=n=>{scene.setFrameTime(Time.fromDecimal(n),frameRate(30));scene.updateWorld();};
 for(const n of [4077,4078,4234.99,4235,4383,4529.99,4530,4535.99,4536].reverse()){
  at(n);assert.equal(scene.nodes.has('biome-world'),n>=4078&&n<4536);assert.equal(scene.cameraNode.id==='biome-camera',n>=4078&&n<4530);
 }
 at(4300);let grounded=0;
 for(const n of [4078,4084,4088,4090]){
  at(n);const m=scene.world.get('biome-reaction-surprise'),point=scene.projectCameraPoint({x:m[12],y:m[13]-scene.world.get(scene.cameraNode.id)[13],z:m[14]});
  assert(Math.abs(320+point.x*100-128)<.002);assert(Math.abs(180-point.y*100-15)<.002);
  assert.equal(scene.requireComponent('biome-reaction-pilot','SpriteRenderer').color.a,1,'Outgoing pilot stays opaque');
  assert.equal(scene.requireComponent('biome-entry-fade','Transition').progress,Math.max(0,(n-4087)/4));
 }
 at(4079);assert(scene.isActive('biome-reaction-pilot'),'Pilot remains visible between glyph flashes');assert(!scene.isActive('biome-reaction-surprise'));
 at(4300);
 for(const [id,m]of scene.world)if(/^biome-(cactus-\d+|desert-creature-\d+|snowman-\d+-body)$/.test(id)){assert(Math.abs(m[13])<1e-8,`${id}: foot on the ground plane`);assert(m[14]>0);grounded++;}
 assert(grounded>60);
 for(const [n,frame]of [[4297,0],[4299,1],[4301,2],[4303,0]]){at(n);assert.equal(scene.spriteState('biome-desert-creature-0').frame,frame);}
 for(const [n,frame]of [[4412,1],[4416,0],[4420,0],[4421,1],[4425,0]]){at(n);assert.equal(scene.spriteState('biome-lightning-2').frame,frame);}
 at(4432);assert.equal(scene.isActive('biome-lightning-2'),false);
 at(4177);const rest=scene.world.get('biome-snowman-0-head')[13];at(4183);const rise=scene.world.get('biome-snowman-0-head')[13]-rest;at(4188);assert(scene.world.get('biome-snowman-0-head')[13]-rest>rise*2);
 for(const binding of data.animation.sequences['biome-flight'].bindings){
  if(/^biome-(cactus|desert-creature)-/.test(binding.object)&&binding.property.path==='localPosition.x')assert.equal(data.animation.tracks[binding.track].frameNumber.length,2,'Ground paths use two position keys');
 }
 const library=JSON.parse(fs.readFileSync(path.join(root,'assets/biome_flight/assets.json'))).assets;
 const fixture={schemaVersion:1,assets:{bolt:{...library.lightning_atlas,file:'/assets/biome_flight/lightning_atlas.png'}},root:{id:'root',children:[
  {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
  {id:'tile',transform:{localPosition:{x:-.5,y:1.8},localScale:{x:10,y:10,z:1}},components:[
   {type:'TiledSpriteRenderer',asset:'bolt',wrap:{x:'repeat',y:'repeat'},clipBounds:{left:0,right:.1,bottom:null,top:null}},
   {type:'SpriteAnimator',framesPerSecond:7,loop:true,hideOutside:false},
   {type:'ProceduralNoise',seed:498,textureSize:{x:32,y:32},worldSize:{x:.32,y:.32},origin:{x:.033,y:-.027},range:.25,bands:[{sigmaTexels:{x:1,y:1},variance:.001}]}
  ]}
 ]}};
 const invalid=structuredClone(fixture);invalid.root.children[1].components[0].frame=2;assert.throws(()=>new Scene(invalid,'http://localhost/scene.json'));
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,renders={};
 try{for(const [name,type,renderer]of [['chromium',chromium,'dom'],['firefox',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden');};});
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=4422`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const settle=()=>page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const seek=async n=>{await page.evaluate(async n=>{await scenePlayer.seekFrame(n,{numerator:30,denominator:1});await scenePlayer.whenIdle();},n);await settle();};
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   await settle();const first=await shot();renders[name]=first;fs.writeFileSync(path.join(output,`${name}-4422.png`),first);
   const im=png(first),sample=(x,y)=>Array.from(im.pixels.subarray((y*im.width+x)*im.channels,(y*im.width+x)*im.channels+3));
   assert(sample(320,10)[2]>180,`${name}: upper cloud visible`);assert(sample(100,180)[0]<45,`${name}: noise preserves transparent cloud cells`);
   for(const n of [4536,4078,4194,4245,4300,4384,4422])await seek(n);
   assert(compare(first,await shot()).mae<.01,`${name}: deterministic rewind`);
   for(const size of [{width:390,height:844},{width:1440,height:400}]){
    await page.setViewportSize(size);await settle();await seek(4245);assert.equal(await page.evaluate(()=>scenePlayer.scene.cameraNode.id),'biome-camera');
    await seek(4422);await page.screenshot({path:path.join(output,`${name}-${size.width}.png`),style:'.runtime-loading-status{visibility:hidden!important}'});
   }
   await page.setViewportSize({width:640,height:360});await page.evaluate(f=>scenePlayer.loadScene(f),fixture);await seek(0);const phase0=await shot();await seek(5);const phase1=await shot();assert(compare(phase0,phase1).mae>1,`${name}: tiled atlas switches poses`);
   await page.evaluate(()=>scenePlayer.setComponent('tile','ProceduralNoise',{enabled:false}));await settle();const plain=png(await shot()),textured=png(phase1);let changed=0;
   for(let i=0;i<plain.width*plain.height;i++){
    const k=i*plain.channels,empty=plain.pixels[k]+plain.pixels[k+1]+plain.pixels[k+2]===0;
    for(let c=0;c<3;c++){if(empty)assert.equal(textured.pixels[k+c],0,`${name}: alpha noise cannot fill empty cells`);if(plain.pixels[k+c]!==textured.pixels[k+c])changed++;}
   }
   assert(changed>100,`${name}: procedural noise changes visible tiled art`);
   await page.evaluate(()=>scenePlayer.setComponent('tile','ProceduralNoise',{enabled:true}));await settle();assert(compare(phase1,await shot()).mae<.001,'Noise restore is deterministic');
   if(renderer==='dom'){
    assert.equal(await page.locator('canvas').count(),0);
    const writes=await page.evaluate(async()=>{const observer=new MutationObserver(()=>{});observer.observe(scenePlayer.viewport,{attributes:true,childList:true,subtree:true});await scenePlayer.update();await scenePlayer.whenIdle();const n=observer.takeRecords().length;observer.disconnect();return n;});assert.equal(writes,0,'Paused tile updates reuse the DOM');
   }
   // An affine palette remains live: the identical exhaust cells become blue.
   const particles={schemaVersion:1,assets:{fire:{...data.assets.exhaust,file:'/assets/exhaust/exhaust_atlas.png'}},root:{id:'root',children:[fixture.root.children[0],{id:'emitter',components:[{type:'ParticleEmitter',asset:'fire',rate:0,bursts:[{time:0,count:1}],lifetime:{min:10,max:10},speed:{min:0,max:0},startSize:{min:1,max:1},colorMatrix:[0,0,1,0,0,1,0,0,1,0,0,0]}]}]}};
   await page.evaluate(f=>scenePlayer.loadScene(f),particles);await seek(1);const blue=png(await shot());let sum=[0,0,0];for(let i=0;i<blue.width*blue.height;i++)for(let c=0;c<3;c++)sum[c]+=blue.pixels[i*blue.channels+c];assert(sum[2]>sum[0]*3,`${name}: exhaust palette rotates red into blue`);
   assert.deepEqual(errors,[]);console.log(`${name}: grounded perspective, cloud alpha, tiled animation, palette, expanded aspect and rewind passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
 const parity=compare(renders.chromium,renders.babylon);assert(parity.mae<5,`Renderer agreement: ${JSON.stringify(parity)}`);console.log('Biome renderer mean difference:',parity.mae);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
