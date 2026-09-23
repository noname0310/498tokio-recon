const assert=require('node:assert/strict'),{chromium,firefox}=require('playwright');
const {makeServer}=require('./serve.cjs'),{compare}=require('./pixel-check.cjs');

async function main(){
 const server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type]of [['chromium',chromium],['firefox',firefox]]){
  const browser=await type.launch({headless:true,...(type===chromium?{executablePath:chromium.executablePath()}: {})});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`${origin}/?renderer=babylon&controls=0&frame=2390`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=frame=>page.evaluate(async frame=>{await scenePlayer.seekFrame(frame,{numerator:30,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},frame);
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   const initial=await shot();
   const uploads=await page.evaluate(async()=>{
    const p=scenePlayer,r=p.renderer,prototype=r.B.Mesh.prototype,updates=[];
    const updated=prototype.thinInstanceBufferUpdated,bound=prototype.thinInstanceSetBuffer;
    const record=mesh=>updates.push({name:mesh.name,visible:mesh.isVisible});
    prototype.thinInstanceBufferUpdated=function(...args){record(this);return updated.apply(this,args);};
    prototype.thinInstanceSetBuffer=function(...args){record(this);return bound.apply(this,args);};
    try{
     for(const frame of [2391,2398,2402,2390])await p.seekFrame(frame,{numerator:30,denominator:1});
     await p.seekFrame(2390,{numerator:30,denominator:1});await p.whenIdle();
     return {hidden:updates.filter(x=>!x.visible),count:updates.length};
    }finally{prototype.thinInstanceBufferUpdated=updated;prototype.thinInstanceSetBuffer=bound;}
   });
   assert(uploads.count>0);assert.deepEqual(uploads.hidden,[],'Hidden owner/run meshes must not upload instance buffers');
   await seek(2390);assert(compare(initial,await shot()).max<=1,'Buffer growth and rewind preserve the original pixels');
   const hiddenSort=await page.evaluate(async()=>{
    const p=scenePlayer,mesh=p.renderer.scene.meshes.find(m=>!m.isEnabled()&&m.material?.needAlphaBlending());
    if(!mesh)throw Error('Expected an inactive transparent sprite');
    mesh.alphaIndex=123456;await p.update();await p.whenIdle();return mesh.alphaIndex;
   });assert.equal(hiddenSort,123456,'Inactive transparent meshes must not participate in sorting');

   for(const frame of [2435,2437,2439])await seek(frame);
   await seek(2435);const bullet=await shot();
   const cache=await page.evaluate(async()=>{
    const p=scenePlayer,o=p.renderer.objects.find(o=>o.id==='asteroid-shot-0-0'),context=o.renderer,original=context.texture;let creations=0;
    context.texture=function(name,...args){if(name===o.id+'/Glow')creations++;return original.call(this,name,...args);};
    try{
     for(const frame of [2437,2439,2435,2439,2437,2435])await p.seekFrame(frame,{numerator:30,denominator:1});
     await p.whenIdle();return {creations,entries:o.maskTextures.size};
    }finally{context.texture=original;}
   });assert.equal(cache.creations,0,'Revisiting prepared sprite frames must reuse their GPU masks');assert(cache.entries>=3);
   await seek(2435);assert(compare(bullet,await shot()).max<=1,'Cached masks preserve sprite glow pixels');

   // Test edits, LRU eviction, disabled effects and disposal on a static sprite.
   const fixture={schemaVersion:1,assets:{art:{type:'Sprite',file:'/assets/starfield/point.png',size:{x:1,y:1},pixelsPerUnit:10}},root:{id:'root',children:[
    {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
    {id:'sprite',components:[{type:'SpriteRenderer',asset:'art'},{type:'Glow',sigmaWorld:.03},{type:'DropShadow',sigmaWorld:.02}]},
    {id:'stream',transform:{localPosition:{x:1}},components:[{type:'ParticleEmitter',asset:'art',rate:0,bursts:[{time:0,count:3},{time:1,count:2}],speed:{min:0,max:0},lifetime:{min:10,max:10},startSize:{min:.2,max:.4},sortMode:'sizeAscending'},{type:'Glow',sigmaWorld:.02}]}
   ]}};
   await page.evaluate(async data=>{await scenePlayer.loadScene(data);await scenePlayer.whenIdle();},fixture);
   const sorted=await shot();
   const modes=await page.evaluate(async()=>{
    const p=scenePlayer,o=p.renderer.objects.find(o=>o.id==='stream'),prototype=p.renderer.B.Mesh.prototype,original=prototype.thinInstanceBufferUpdated;let hiddenUploads=0;
    prototype.thinInstanceBufferUpdated=function(...args){if(!this.isVisible)hiddenUploads++;return original.apply(this,args);};
    try{
     await p.setComponent('stream','Glow',{enabled:false});await p.seek(1.1);await p.seek(.6);
     await p.setComponent('stream','ParticleEmitter',{sortMode:'depth'});const depthHasInstances=o.entries[0].mesh.hasThinInstances;
     await p.setComponent('stream','Glow',{enabled:true});await p.seek(1.1);
     await p.setComponent('stream','ParticleEmitter',{sortMode:'sizeAscending'});await p.seek(0);await p.whenIdle();
     return {hiddenUploads,depthHasInstances};
    }finally{prototype.thinInstanceBufferUpdated=original;}
   });
   assert.equal(modes.hiddenUploads,0);assert(modes.depthHasInstances,'Switching from size order must lazily bind the owner buffers');
   assert(compare(sorted,await shot()).max<=1,'Sort/glow toggles retain identical pixels');
   const bounds=await page.evaluate(async()=>{
    const p=scenePlayer,o=p.renderer.objects.find(o=>o.id==='sprite');
    const original=o.textures.get('Glow');
    await p.setComponent('sprite','Glow',{intensity:2,color:{r:1,g:0,b:0,a:1}});const same=original===o.textures.get('Glow');
    await p.setComponent('sprite','Glow',{enabled:false,sigmaWorld:.04});const disabled=o.textures.get('Glow')===original;
    await p.setComponent('sprite','Glow',{enabled:true});const resized=o.textures.get('Glow')!==original;
    const evicted=o.textures.get('Glow');
    for(let i=0;i<40;i++)await p.setComponent('sprite','Glow',{sigmaWorld:.05+i*.001});
    await p.whenIdle();
    const entries=o.maskTextures.size,bytes=o.maskBytes,activeReady=['Glow','DropShadow'].every(type=>o.textures.get(type).isReady());
    const oldDisposed=evicted.getInternalTexture()===null,retained=[...o.maskTextures.values()].map(mask=>mask.texture);
    await p.removeEntity('sprite');await p.whenIdle();
    return {same,disabled,resized,entries,bytes,activeReady,oldDisposed,disposed:retained.every(texture=>texture.getInternalTexture()===null),lost:p.renderer.engine._gl.isContextLost()};
   });
   assert(bounds.same&&bounds.disabled&&bounds.resized);assert(bounds.entries<=32&&bounds.bytes<=8*1024*1024);
   assert(bounds.activeReady&&bounds.oldDisposed&&bounds.disposed);assert.equal(bounds.lost,false);assert.deepEqual(errors,[]);
   console.log(`${name}: visible instance uploads, sort/glow toggles, GPU mask reuse, LRU and disposal passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
