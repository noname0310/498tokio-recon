const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright'),{makeServer}=require('./serve.cjs');
const seq=(end,extra={})=>({tickResolution:{numerator:30,denominator:1},displayRate:{numerator:30,denominator:1},playbackRange:{start:0,end},...extra});
const noise={type:'ProceduralNoise',seed:419,textureSize:{x:16,y:16},bands:[{sigmaTexels:{x:1,y:1},variance:.02}]};
const fixture={schemaVersion:1,assets:{art:{type:'Sprite',file:'/tests/fixtures/rect_sprite.png',size:{x:2,y:3},pixelsPerUnit:4}},root:{id:'unrelated-root',children:[
  {id:'view',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]}
]},animation:{master:'master',tracks:{radius:{type:'AnimationTrackFloat32',frameNumber:[0,30],value:[0,0],interpolation:[8,0,2,2],interpolationParameters:[.2,-1,-.2,-1]}},sequences:{
  master:seq(180,{sequences:[{id:'outer',sequence:'middle',range:{start:30,end:150}}]}),
  middle:seq(120,{sequences:[{id:'inner',sequence:'detail',range:{start:30,end:60}},{id:'again',sequence:'detail',range:{start:75,end:105}}]}),
  detail:seq(30,{objects:[{id:'spawn',kind:'spawnable',template:{id:'effect',components:[{type:'ParticleEmitter',asset:'art'},{type:'ParticleMotionBlur',softnessPixels:.1},{type:'Glow'}],children:[
    {id:'sprite',components:[{type:'SpriteRenderer',asset:'art'},noise]},
    {id:'plane',components:[{type:'PlaneRenderer'},noise]}
  ]}}],bindings:[{id:'curve',object:'spawn',track:'radius',property:{component:'ParticleMotionBlur',path:'dilationPixels'}}]})
}}};

async function main(){
 const server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer] of [['chromium-dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['chromium-babylon',chromium,'babylon'],['firefox-babylon',firefox,'babylon']]){
  const browser=await type.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{const convert=OffscreenCanvas.prototype.convertToBlob;window.encodes=0;OffscreenCanvas.prototype.convertToBlob=function(...args){window.encodes++;return convert.apply(this,args);};});
   await page.goto(`${origin}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   if(renderer==='dom'){
    const samples=await page.evaluate(async()=>{
     const p=scenePlayer;await p.seekFrame(840,{numerator:30,denominator:1});await p.whenIdle();const encodes=window.encodes;
     const snapshots=[],urls=[];
     for(let repeat=0;repeat<2;repeat++){
      await p.seekFrame(840,{numerator:30,denominator:1});await p.play();
      await new Promise(resolve=>{const tick=()=>{const o=p.renderer.objects.find(o=>o.id==='forward-moon');if(o){const surface=o.elements.get('SpriteRenderer');snapshots.push({frame:p.time*30,visible:!surface.element.hidden,complete:surface.image.complete,noise:!!o.noiseImage.getAttribute('href'),depth:surface.element.style.zIndex});urls.push(o.noiseURL);p.pause();resolve();}else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
     }
     return {snapshots,sameURL:urls[0]===urls[1],encodes:window.encodes-encodes};
    });
    for(const s of samples.snapshots){assert(s.frame>=851&&s.frame<856);assert(s.visible&&s.complete&&s.noise&&s.depth!=='',JSON.stringify(s));}
    assert.equal(samples.sameURL,true);assert.equal(samples.encodes,0,'Respawn must not encode procedural PNGs');
   }else{
    const tour=await page.evaluate(async()=>{
     const p=scenePlayer,e=p.renderer.engine,gl=e._gl,create=gl.createProgram.bind(gl),before=new Set(Object.keys(e._compiledEffects));let programs=0;
     // A browser GPU-context recovery must rebuild every program. Count only
     // normal playback compilation, independent of driver/context resets.
     gl.createProgram=(...args)=>{if(!e._contextWasLost)programs++;return create(...args);};
     for(const frame of [15,173,480,547,548,600,800,851,1100,1145,1158,1220,1355,1670,1730,1900,2100,2180,2181,2189,2196,2214,2224,2236,2245,2611,2633,2646,3504,3708,3777,3940,3995,4088,4091,4194,4245,4422,4535])await p.seekFrame(frame,{numerator:30,denominator:1});
     gl.createProgram=create;return {programs,newEffects:Object.keys(e._compiledEffects).filter(k=>!before.has(k))};
    });
    assert.deepEqual(tour,{programs:0,newEffects:[]},'Playback must reuse the prepared GPU programs');
   }
   await page.route('**/dynamic.scene.json',route=>route.fulfill({json:fixture}));
   if(renderer==='babylon')await page.evaluate(()=>{
    const prototype=scenePlayer.renderer.B.ShaderMaterial.prototype,compile=prototype.forceCompilationAsync;let first=true;
    const gate=new Promise(resolve=>window.releaseCompile=resolve);
    prototype.forceCompilationAsync=async function(...args){await compile.apply(this,args);if(first){first=false;await gate;}};
    window.restoreCompile=()=>{prototype.forceCompilationAsync=compile;};
   });
   await page.evaluate(()=>{window.stageOrder=[];scenePlayer.loadingProgress.subscribe(stages=>{for(const s of stages)if(s.items.size&&!window.stageOrder.includes(s.name))window.stageOrder.push(s.name);});});
   await page.evaluate(()=>scenePlayer.loadScene('/dynamic.scene.json'));
   if(renderer==='babylon'){
    await page.waitForFunction(()=>document.querySelector('[data-stage="Shaders"]'));
    await page.evaluate(()=>scenePlayer.play());await page.waitForFunction(()=>scenePlayer.time>.12);await page.evaluate(()=>{scenePlayer.pause();window.releaseCompile();window.restoreCompile();});
   }
   await page.evaluate(()=>scenePlayer.whenIdle());
   const dynamic=await page.evaluate(async()=>{
    const p=scenePlayer,declared=[...p.scene.declaredEntities()],noiseNode=declared.find(n=>n.components.some(c=>c.type==='ProceduralNoise'));
    const noise=noiseNode.components.find(c=>c.type==='ProceduralNoise'),one=await p.resources.noiseURL(noise),two=await p.resources.noiseURL(structuredClone(noise));
    const count=window.encodes,engine=p.renderer.kind==='babylon'?p.renderer.engine:null,keys=engine?new Set(Object.keys(engine._compiledEffects)):null;
    const overshoot=p.scene.sequence.tracks.get('radius').valueBounds({numerator:30,denominator:1});
    for(const frame of [60,65,75,85,90,106,120,134,139,0])await p.seekFrame(frame,{numerator:30,denominator:1});
    return {same:one===two,encodes:window.encodes-count,newEffects:engine?Object.keys(engine._compiledEffects).filter(k=>!keys.has(k)):[],overshoot,stageOrder:window.stageOrder};
   });
   assert.equal(dynamic.same,true);assert.equal(dynamic.encodes,0);assert.deepEqual(dynamic.newEffects,[]);
   assert(dynamic.overshoot.max>=2,'Curve bounds include overshoot, not only endpoint values');
   assert.deepEqual(dynamic.stageOrder,renderer==='babylon'?['Scene','Images','Textures','Shaders']:['Scene','Images','Textures']);
   if(renderer==='babylon'){
    const cancellation=await page.evaluate(async data=>{
     const p=scenePlayer,prototype=p.renderer.B.ShaderMaterial.prototype,compile=prototype.forceCompilationAsync;let entered;
     const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>window.releaseOldCompile=resolve);
     prototype.forceCompilationAsync=async function(...args){await compile.apply(this,args);entered();await gate;};
     await p.loadScene(data);await started;const old=p.whenIdle();prototype.forceCompilationAsync=compile;
     const replacement=structuredClone(data);delete replacement.animation;replacement.assets={};await p.loadScene(replacement);await old;window.releaseOldCompile();await p.whenIdle();
     const scenes=p.renderer.engine.scenes.length;p.dispose();return {scenes,removed:!document.querySelector('.runtime-loading-status')};
    },fixture);
    assert.deepEqual(cancellation,{scenes:2,removed:true});
   }
   assert.deepEqual(errors,[]);console.log(`${name}: first-frame noise, nested declarations, preparation/cache reuse and lifecycle passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
