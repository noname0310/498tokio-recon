const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json');
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),data=JSON.parse(fs.readFileSync(file)),scene=new Scene(data,pathToFileURL(file).href);
 assert.deepEqual([...scene.authoredNodes.keys()].sort(),['final-animation','camera','landscape-camera','interior-camera','helmet-bars-camera','helmet-flat-camera','playback'].sort());
 const ranges=[['intro-content',0,559],['starfield-content',548,900],['forward-scene',851,1156],['paper-content',1145,1220],['landscape-scene',1220,1727],['landscape-camera-layers',1220,1727],['interior-scene',1727,2196],['helmet-launch-scene',2196,2256],['asteroid-scene',2256,2537]];
 const at=n=>{scene.setFrameTime(Time.fromDecimal(n),frameRate(30));scene.updateWorld();};
 const probes=[...new Set(ranges.flatMap(([,start,end])=>[Math.max(0,start-.001),start,end-.001,end]).concat([173,1735,2098,2189,2245,6899]))];
 for(const n of probes.concat(probes.toReversed())){
  at(n);for(const [id,start,end]of ranges)assert.equal(scene.nodes.has(id),n>=start&&n<end,`${id} ownership at ${n}`);
  assert.equal(scene.authoredNodes.size,7);for(const id of scene.nodes.keys())assert(scene.parents.get(id)===null||scene.nodes.has(scene.parents.get(id).id));
 }
 at(2537);assert.equal(scene.nodes.size,7);assert.equal(scene.isActive('helmet-launch-hull'),false);
 // Reusable prefabs remap internal entity references per instance; scene IDs
 // are accepted only when the entire compiled graph has one unique owner.
 const definition={tickResolution:{numerator:30,denominator:1},displayRate:{numerator:30,denominator:1},playbackRange:{start:0,end:30}};
 const template={id:'prefab',children:[{id:'incoming',children:[{id:'plane',components:[{type:'PlaneRenderer'}]}]},{id:'mask',components:[{type:'Transition',kind:'grid',target:{entity:'incoming'}}]}]};
 const fixture={schemaVersion:1,root:{id:'root',children:[{id:'camera',components:[{type:'Camera'}]}]},animation:{master:'master',tracks:{},sequences:{
  master:{...definition,sequences:[{id:'one',sequence:'child',range:{start:0,end:30}},{id:'two',sequence:'child',range:{start:0,end:30}}]},
  child:{...definition,objects:[{id:'content',kind:'spawnable',template}]}
 }}};
 const instanced=new Scene(fixture,'http://localhost/scene.json'),masks=[...instanced.nodes.values()].filter(n=>n.id.endsWith('/mask'));
 assert.equal(masks.length,2);for(const mask of masks){const target=instanced.component(mask.id,'Transition').target.entity;assert.equal(target,mask.id.replace(/\/mask$/,'/incoming'));assert(instanced.nodes.has(target));}
 const unique=structuredClone(fixture);unique.animation.sequences.master.sequences.pop();unique.animation.sequences.child.objects[0].idScope='scene';
 assert(new Scene(unique,'http://localhost/scene.json').nodes.has('incoming'));
 unique.animation.sequences.master.sequences.push({id:'again',sequence:'child',range:{start:30,end:60}});
 assert.throws(()=>new Scene(unique,'http://localhost/scene.json'),/Spawn ID collision/);
 console.log('Lifetimes: exact boundaries, seven resident entities, nested room ownership, ID scopes and prefab references passed.');
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [label,type,renderer]of [['dom',chromium,'dom'],['babylon',chromium,'babylon'],['firefox-dom',firefox,'dom']]){
  const browser=await type.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{const Original=Worker;window.workerCount=0;window.Worker=class extends Original{constructor(...args){super(...args);window.workerCount++;}};});
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=173`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const first=await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"});await page.evaluate(()=>{window.retained={clock:scenePlayer.clock,resources:scenePlayer.resources,camera:scenePlayer.scene.find('camera'),object:scenePlayer.renderer.objects.find(o=>o.id==='moon'),images:scenePlayer.resources.images.size};});
   for(const n of [558,600,900,1150,1500,1943,2189,2200,2245,2256,2390,2536,2537])await page.evaluate(async n=>{await scenePlayer.seekFrame(n,{numerator:30,denominator:1});await scenePlayer.whenIdle();},n);
   assert.deepEqual(await page.evaluate(()=>({nodes:scenePlayer.scene.nodes.size,objects:scenePlayer.renderer.objects.length,disposed:window.retained.object.disposed,cache:scenePlayer.resources===window.retained.resources&&scenePlayer.resources.images.size===window.retained.images,clock:scenePlayer.clock===window.retained.clock,camera:scenePlayer.scene.find('camera')===window.retained.camera,workers:window.workerCount})),{nodes:7,objects:0,disposed:true,cache:true,clock:true,camera:true,workers:1});
   await page.evaluate(async()=>{await scenePlayer.seekFrame(173,{numerator:30,denominator:1});await scenePlayer.whenIdle();});
   const diff=compare(first,await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}));assert(diff.mae<.001&&diff.max<=3,`${label} rewind: ${JSON.stringify(diff)}`);
   assert(await page.evaluate(()=>scenePlayer.renderer.objects.find(o=>o.id==='moon')!==window.retained.object));assert.deepEqual(errors,[]);
   console.log(`${label}: chapter disposal, shared clock/cameras/image cache/worker and deterministic re-entry passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
