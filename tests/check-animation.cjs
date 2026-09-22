const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {pathToFileURL}=require("node:url"),{chromium}=require("playwright"),{makeServer}=require("./serve.cjs");
const root=path.resolve(__dirname,".."),base="http://localhost/";
let api;
const float=(frameNumber,value,interpolation)=>({type:"AnimationTrackFloat32",frameNumber,value,...interpolation?{interpolation}:{}});
const integer=(frameNumber,value)=>({type:"AnimationTrackInt32",frameNumber,value,interpolation:frameNumber.flatMap(()=>[0,-1])});
const bool=(frameNumber,value)=>({type:"AnimationTrackBoolean",frameNumber,value});
const bind=(id,track,object,component,property,extra={})=>({id,track,object,property:{component,path:property},...extra});
const possess=(id,entity)=>({id,kind:"possessable",target:{entity}});
const sequence=(ticks,end,extra={})=>({tickResolution:{numerator:ticks,denominator:1},displayRate:{numerator:30,denominator:1},playbackRange:{start:0,end},...extra});
const exhaustAsset=JSON.parse(fs.readFileSync(path.join(root,"assets/exhaust/exhaust.scene.json"),"utf8")).assets.exhaust;
function fixture(){return {schemaVersion:1,timeline:{autoplay:false,loop:false},assets:{art:{...structuredClone(exhaustAsset),file:"/assets/exhaust/exhaust_atlas.png",pixelsPerUnit:10}},root:{id:"root",children:[
  {id:"camera",transform:{localPosition:{z:-10}},components:[{type:"Camera",referenceVerticalSize:3.6}]},
  {id:"actor",transform:{localPosition:{x:7}},components:[{type:"SpriteRenderer",asset:"art"}]},
  {id:"anchor",transform:{localPosition:{x:-1}}},
]},animation:{master:"main",tracks:{move:float([0,30],[0,3]),frame:integer([0,10,20,30],[0,1,2,3]),spawn:bool([0,10,20,30],[1,0,1,0])},sequences:{
  main:sequence(24000,192000,{objects:[possess("a","actor"),possess("parent","anchor")],sequences:[{id:"first",sequence:"child",range:{start:24000,end:48000},bindingOverrides:{slot:{binding:"a"},parent:{binding:"parent"}}},{id:"second",sequence:"child",range:{start:72000,end:96000},bindingOverrides:{slot:{binding:"a"},parent:{binding:"parent"}}}]}),
  child:sequence(30,30,{objects:[{id:"slot",kind:"possessable"},{id:"parent",kind:"possessable"},{id:"spawned",kind:"spawnable",parent:{binding:"parent"},spawnTrack:"spawn",template:{id:"actor",components:[{type:"SpriteRenderer",asset:"art"}],children:[{id:"child"}]}},{id:"detail",kind:"possessable",target:{binding:"spawned",descendant:"child"}}],bindings:[bind("x","move","slot","Transform","localPosition.x"),bind("atlas","frame","spawned","SpriteRenderer","frame"),bind("child-y","move","detail","Transform","localPosition.y")]}),
}}};}
function timeAndTracks(){
  const {Frame:F,Time:T,frameRate,AnimationTrackFloat32:Float,AnimationTrackInt32:Int,AnimationTrackBoolean:Bool,createTrack,trackData,Interpolation:I,weightedBezier}=api;
  const n=F.from,t=T.fromDecimal,rate=frameRate(30),near=(a,b,tolerance=1e-6)=>assert(Math.abs(a-b)<tolerance,`${a} != ${b}`);
  for(const bad of [NaN,Infinity,-Infinity,.5,-.5,2236/30,2147483648,-2147483649,"12",null,undefined])assert.throws(()=>n(bad));
  assert.throws(()=>F.next(F.max));assert.throws(()=>F.previous(F.min));assert.throws(()=>F.divide(n(3),2));
  assert.equal(F.add(n(2147483000),n(647)),F.max);assert.equal(F.multiply(n(10),3),30);assert.equal(F.divide(n(-12),3),-4);
  assert.deepEqual(t(-.5),{frame:-1,subframe:{numerator:1n,denominator:2n}});
  assert.equal(T.key(T.add(t(-.5),t(.75))),"0:1/4");assert.equal(T.ceil(t(-.5)),0);assert.equal(T.floor(t(-.5)),-1);
  const r=frameRate(30000,1001),ticks=frameRate(24000),large=T.fromRatio(4294966000001n,2000n);
  const converted=T.convert(large,ticks,r);assert.equal(T.compare(T.convert(converted,r,ticks),large),0);assert.throws(()=>T.convert(large,r,ticks));
  assert.equal(T.key(T.convert(T.fromFrame(n(1)),r,ticks)),"800:4/5");
  for(let frame=0;frame<=2256;frame++){
    const exact=T.convert(T.fromFrame(n(frame)),rate,ticks);
    assert.equal(T.key(exact),`${frame*800}:0/1`);
    assert.equal(T.compare(T.convert(exact,ticks,rate),T.fromFrame(n(frame))),0);
  }
  for(const frame of [2225,2236,2245]){
    const gate=new Bool({frameNumber:[0,frame*800],value:[0,1]});
    const before=T.convert(T.fromRatio(BigInt(frame)*10n**18n-1n,10n**18n),rate,ticks);
    assert.equal(gate.evaluate(before),false,"A true subframe cannot be snapped across a key");
    assert.equal(gate.evaluate(T.convert(T.fromFrame(n(frame)),rate,ticks)),true);
  }
  assert(T.compare(T.fromSeconds(2236/30,ticks),T.convert(T.fromFrame(n(2236)),rate,ticks))<0,"Rounded seconds stay seconds; exact frame callers use convert/seekFrame");
  for(const bad of [.5,NaN,Infinity,2147483648])assert.throws(()=>new Float({frameNumber:[bad],value:[1]}),"Validate before Int32Array can truncate key times");
  assert.equal(T.key(T.wrap(t(-.25),n(0),n(10))),"9:3/4");
  assert.equal(T.compare(T.fromMicroseconds(1000000n,ticks),T.fromFrame(n(24000))),0);
  const f=new Float({frameNumber:[2147483640,2147483644,2147483647],value:[0,4,7]});
  assert(f.frameNumber instanceof Int32Array&&f.value instanceof Float32Array&&f.interpolation instanceof Int32Array&&f.interpolationParameters instanceof Float32Array);
  assert.equal(f.byteLength,3*(4+4+8));assert.equal(f.interpolationParameters.byteLength,0);assert.equal(f.evaluate(T.fromRatio(4294967283n,2n)),1.5);
  for(const frame of [2147483646,2147483641,2147483647,2147483640])assert.equal(f.evaluate(T.fromFrame(n(frame))),frame-2147483640);
  assert(!("binding" in f)&&!("object" in f));
  const i=new Int({frameNumber:[0,10],value:[0,5]});assert(i.value instanceof Int32Array);assert.equal(i.evaluate(t(3)),2);
  const b=new Bool({frameNumber:[0,10],value:[0,1]});assert(b.value instanceof Uint8Array);assert.equal(b.evaluate(t(9.999)),false);assert.equal(b.evaluate(t(10)),true);
  assert.throws(()=>new Bool({frameNumber:[0],value:[2]}));assert.throws(()=>new Int({frameNumber:[0],value:[.5]}));assert.throws(()=>new Float({frameNumber:[1,1],value:[0,1]}));
  assert.throws(()=>new Float({frameNumber:[0],value:[1e40]}));assert.throws(()=>new Bool({frameNumber:[0],value:[1],interpolation:[5,-1]}));
  assert.equal(new Float({frameNumber:[],value:[],defaultValue:2.5}).evaluate(t(1)),2.5);assert.equal(new Float({frameNumber:[],value:[]}).evaluate(t(1)),undefined);
  const hermite=createTrack(trackData("AnimationTrackFloat32",[{frame:n(0),value:0,outMode:I.FCurve},{frame:n(30),value:1,inMode:I.FCurve}]));
  near(hermite.evaluate(t(7.5),rate),.15625);
  const mixed=createTrack(trackData("AnimationTrackFloat32",[{frame:n(0),value:0,outMode:I.Linear},{frame:n(30),value:1,inMode:I.FCurve}]));
  near(mixed.evaluate(t(15),rate),.625);
  // Known handles in (seconds, value): (0.2,0.4) and (0.6,0.2).
  // Bx(0.25)=0.184375; By(0.25)=0.2125, independent of the inverse solver.
  const weighted=createTrack(trackData("AnimationTrackFloat32",[{frame:n(0),value:0,outMode:I.FCurve,outTangent:2/30,outWeight:Math.hypot(.2,.4)},{frame:n(30),value:1,inMode:I.FCurve,inTangent:2/30,inWeight:Math.hypot(.4,.8)}]));
  near(weighted.evaluate(t(.184375*30),rate),.2125);
  const twice=createTrack(trackData("AnimationTrackFloat32",[{frame:n(0),value:0,outMode:I.FCurve,outTangent:2/60,outWeight:Math.hypot(.2,.4)},{frame:n(60),value:1,inMode:I.FCurve,inTangent:2/60,inWeight:Math.hypot(.4,.8)}]));
  near(twice.evaluate(t(.184375*60),frameRate(60)),weighted.evaluate(t(.184375*30),rate));
  const roots=(1+Math.sqrt(.6))/2;near(weightedBezier(.5,2,1/3,-1,2/3,0,1),roots);
  const incomingStep=createTrack(trackData("AnimationTrackFloat32",[{frame:n(0),value:2},{frame:n(10),value:4,inMode:I.Step}]));assert.equal(incomingStep.evaluate(t(9)),2);assert.equal(incomingStep.evaluate(t(10)),4);
  assert.deepEqual(createTrack(JSON.parse(JSON.stringify(weighted))).toJSON(),weighted.toJSON());
  // Mixed records keep fixed-width headers and allocate only the curve sides.
  const packed=trackData("AnimationTrackFloat32",[
    {frame:n(0),value:0,outMode:I.FCurve,outTangent:.1},
    {frame:n(10),value:1,inMode:I.FCurve,inTangent:.2},
    {frame:n(20),value:2,inMode:I.Step,outMode:I.Step},
    {frame:n(30),value:3},
    {frame:n(40),value:4,inMode:I.FCurve,outMode:I.FCurve,inTangent:.3,outTangent:.4}
  ]);
  assert.deepEqual(packed.interpolation,[9,0,6,2,0,-1,5,-1,10,4]);
  assert.deepEqual(packed.interpolationParameters,[.1,-1,.2,-1,.3,-1,.4,-1]);
  const compact=createTrack(packed);assert.equal(compact.byteLength,5*16+8*4);
  assert.equal(new Bool({frameNumber:[0,10],value:[0,1]}).interpolationParameters.length,0);
  for(const mode of [3,12,16,-1,1.5,2**32+5])assert.throws(()=>new Float({frameNumber:[0],value:[0],interpolation:[mode,-1]}));
  for(const index of [-1,1,2,2147483648])assert.throws(()=>new Float({frameNumber:[0],value:[0],interpolation:[9,index],interpolationParameters:[0,-1]}));
  assert.throws(()=>new Float({frameNumber:[0],value:[0],interpolation:[5,0]}));
  assert.throws(()=>new Float({frameNumber:[0],value:[0],interpolation:[10,0],interpolationParameters:[0,-1]}));
  const shuffled=createTrack({...packed,interpolation:[9,2,6,0,0,-1,5,-1,10,4],interpolationParameters:[.2,-1,.1,-1,.3,-1,.4,-1]});
  for(const frame of [5,35,15,25,39,0,40,7])assert.equal(shuffled.evaluate(t(frame),rate),compact.evaluate(t(frame),rate));
  console.log("Animation: branded Int32 bounds, rational time/rates, packed arrays, typed values, independent tangents, weighted Bezier and multiple roots passed.");
}
function hierarchyChecks(){
  const {Scene,Time:T,Frame:F,frameRate}=api,source=fixture(),s=new Scene(source,base),exported=s.export();
  // Procedural components share the exact scene clock, including scenes without
  // a sequence. The origin is an integer source frame, never a Float32 second.
  const timed=fixture();delete timed.animation;
  const origin={frame:2236,rate:frameRate(30)},actor=timed.root.children[1];
  actor.components.push({type:"SpriteAnimator",start:origin,framesPerSecond:30,frames:[0,1,2,3],loop:false,hideOutside:true});
  timed.root.children.push({id:"flicker",components:[{type:"Flicker",start:origin,frequency:15,dutyCycle:.5}]});
  timed.root.children.push({id:"emitter",components:[{type:"ParticleEmitter",asset:"art",start:origin,rate:30,lifetime:{min:1,max:1},animation:{mode:"fps",framesPerSecond:30,frames:[0,1,2,3]}}]});
  const exactScene=new Scene(timed,base),atExact=frame=>{exactScene.setFrameTime(frame,frameRate(30));exactScene.updateWorld();};
  atExact(T.fromRatio(2236n*10n**18n-1n,10n**18n));
  assert.equal(exactScene.spriteState("actor").visible,false);assert.equal(exactScene.active.get("flicker"),false);assert.equal(exactScene.particleStates("emitter").length,0);
  for(const frame of [2236,2237,2238,2239,2236]){
    atExact(T.fromFrame(F.from(frame)));assert.equal(exactScene.spriteState("actor").frame,frame-2236);
    assert.equal(exactScene.active.get("flicker"),(frame-2236)%2===0);
    const particles=exactScene.particleStates("emitter");assert.equal(particles.length,frame-2236+1);
    assert.equal(particles.find(p=>p.id==="0:0").frame,frame-2236);
  }
  for(const frame of [.5,NaN,2147483648]){const bad=structuredClone(timed);bad.root.children[1].components[1].start.frame=frame;assert.throws(()=>new Scene(bad,base));}
  const at=frame=>{s.setFrameTime(T.fromFrame(F.from(frame)),frameRate(30));s.updateWorld();};
  at(35);let spawned=[...s.nodes.keys()].find(id=>id.startsWith("__sequence__")&&id.endsWith("/actor"));
  assert.equal(s.transformAt("actor").localPosition.x,.5);assert.equal(s.nodes.size,6);assert.equal(s.parents.get(spawned).id,"anchor");
  const detail=[...s.nodes.keys()].find(id=>id.startsWith("__sequence__")&&id.endsWith("/child"));assert.equal(s.transformAt(detail).localPosition.y,.5);
  assert.equal(s.component(spawned,"SpriteRenderer").frame,0);
  at(40);assert.equal(s.nodes.size,4);assert.equal(s.transformAt("actor").localPosition.x,1);
  at(50);assert.equal(s.nodes.size,6);assert.equal(s.component(spawned,"SpriteRenderer").frame,2);
  at(60);assert.equal(s.nodes.size,4);assert.equal(s.transformAt("actor").localPosition.x,7);
  at(95);const second=[...s.nodes.keys()].find(id=>id.startsWith("__sequence__")&&id.endsWith("/actor"));assert.notEqual(spawned,second);assert.equal(s.transformAt("actor").localPosition.x,.5);
  at(35);assert(s.nodes.has(spawned));assert.deepEqual(s.export(),exported,"Evaluation cannot bake animated values into authored data");
  s.animationEnabled=false;s.updateWorld();assert.equal(s.nodes.size,4);assert.equal(s.transformAt("actor").localPosition.x,7);
  let iterations=0;for(const node of s.nodes.values()){if(++iterations>4)throw new Error("Editing reset an active entity iterator");s.setTransform(node.id,{localPosition:{z:node.transform.localPosition.z}});s.updateWorld();}assert.equal(iterations,4);
  // Trim ten child ticks; scale by 1/2; wrap in [10,30).
  const loop=fixture();loop.animation.sequences.main.sequences=[{id:"loop",sequence:"child",range:{start:0,end:144000},startOffset:10,timeScale:{numerator:1,denominator:2},loop:true,bindingOverrides:{slot:{entity:"actor"},parent:{entity:"anchor"}}}];
  const l=new Scene(loop,base);l.time=2;l.updateWorld();assert.equal(l.transformAt("actor").localPosition.x,2);l.time=4;l.updateWorld();assert.equal(l.transformAt("actor").localPosition.x,1);
  // An offset master range is still exposed as a timeline starting at zero.
  const shifted=fixture();shifted.animation.sequences.main.playbackRange={start:24000,end:216000};const shift=new Scene(shifted,base);assert.equal(shift.frameTime.frame,24000);assert.equal(shift.transformAt("actor").localPosition.x,0);
  // Priority + additive contribution; a binding's keep mode lasts only inside its sequence.
  const blends=fixture();blends.animation.tracks.constant=float([0],[2]);blends.animation.sequences.main.sequences=[];
  blends.animation.sequences.main.bindings=[bind("replace","constant","a","Transform","localPosition.x",{range:{start:0,end:24000},completionMode:"keep"}),bind("add","constant","a","Transform","localPosition.x",{blend:"additive",weight:.5,priority:10})];
  const blended=new Scene(blends,base);blended.time=2;blended.updateWorld();assert.equal(blended.transformAt("actor").localPosition.x,3);blended.time=8;blended.updateWorld();assert.equal(blended.transformAt("actor").localPosition.x,7);
  const intBlend=fixture();intBlend.animation.sequences.main.sequences=[];intBlend.animation.sequences.main.bindings=[bind("atlas-blend","frame","a","SpriteRenderer","frame",{weight:.5})];
  const rounded=new Scene(intBlend,base);rounded.time=1;rounded.updateWorld();assert.equal(rounded.component("actor","SpriteRenderer").frame,2);
  intBlend.animation.tracks.frame=integer([0],[8]);assert.throws(()=>new Scene(intBlend,base),/outside atlas/);
  // The same data asset can be nested twice concurrently with independent object slots.
  const overlap=fixture();overlap.animation.sequences.main.sequences[1].range={start:24000,end:48000};overlap.animation.sequences.main.sequences[1].bindingOverrides.slot={entity:"anchor"};
  const both=new Scene(overlap,base);both.time=7/6;both.updateWorld();assert.equal(both.nodes.size,8);
  assert.equal(both.transformAt("actor").localPosition.x,both.transformAt("anchor").localPosition.x);
  for(const mutate of [
    d=>d.animation.sequences.child.sequences=[{id:"cycle",sequence:"main",range:{start:0,end:10}}],
    d=>d.animation.sequences.child.objects[2].parent={binding:"detail"},
    d=>d.animation.sequences.child.bindings[0].property.path="__proto__.value",
    d=>d.animation.sequences.child.bindings[0].track="spawn",
    d=>d.animation.sequences.child.objects[2].spawnTrack="move",
    d=>d.animation.sequences.main.sequences[0].timeScale={numerator:1,denominator:0},
    d=>d.animation.sequences.child.bindings[1].track="move",
  ]){const invalid=fixture();mutate(invalid);assert.throws(()=>new Scene(invalid,base));}
  console.log("Sequencer: nested resolutions, binding overrides, independent instances, trimmed loops, spawn gates/parents/descendants, priority, restore and invalid graph rejection passed.");
}

async function browserChecks(){
  const server=makeServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:[chromium.executablePath()].find(fs.existsSync)});
    for(const renderer of ["dom","babylon"]){
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[],requests=[];
      page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});page.on("request",r=>requests.push(r.url()));
      await page.route(/^https?:/,route=>route.request().url().startsWith(origin+"/")?route.continue():route.abort());
      if(renderer==="dom")await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error("DOM canvas forbidden");};window.OffscreenCanvas=class{constructor(){throw new Error("OffscreenCanvas forbidden");}};});
      await page.goto(`${origin}/index.html?scene=assets/intro_background/intro.scene.json&renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
      await page.evaluate(data=>scenePlayer.loadScene(data),fixture());
      const seek=frame=>page.evaluate(async frame=>{const {Frame}=await import("/runtime/player.js");await scenePlayer.seekFrame(Frame.from(frame));},frame);
      const stale=await page.evaluate(async()=>{
        const {Frame}=await import("/runtime/player.js");await scenePlayer.seekFrame(Frame.from(30));
        const original=requestAnimationFrame;let callback;window.requestAnimationFrame=fn=>{callback=fn;return 0;};
        try{scenePlayer.play();callback(performance.now()-100);scenePlayer.pause();return scenePlayer.time;}finally{window.requestAnimationFrame=original;}
      });assert.equal(stale,1,"A stale first RAF timestamp must not move playback before its anchor");
      await seek(35);const initial=await page.screenshot();assert.equal(await page.evaluate(()=>scenePlayer.renderer.objects.length),2);
      if(renderer==="dom")assert(await page.evaluate(()=>{const surfaces=[...document.querySelectorAll('.component[data-entity^="__sequence__"]')];return surfaces.length>0&&surfaces.every(e=>e.parentElement===scenePlayer.renderer.world&&scenePlayer.scene.nodes.has(e.dataset.entity));}),"Spawned surfaces belong directly to the render root");
      else assert.equal(await page.evaluate(()=>Object.hasOwn(window,"BABYLON")),false);
      for(const frame of [40,50,60,95,120,35])await seek(frame);
      assert.deepEqual(await page.screenshot(),initial,`${renderer} rewind must reconstruct the same pixel result`);
      assert.equal(await page.evaluate(()=>scenePlayer.renderer.objects.length),2);
      await page.evaluate(()=>scenePlayer.stop());assert.equal(await page.evaluate(()=>scenePlayer.renderer.objects.length),1);
      assert.equal(await page.evaluate(()=>scenePlayer.scene.transformAt("actor").localPosition.x),7);
      await page.clock.install();await seek(30);await page.evaluate(()=>scenePlayer.play());await page.clock.runFor(500);await page.evaluate(()=>scenePlayer.pause());
      const forward=await page.evaluate(()=>scenePlayer.time);assert(forward>1.45&&forward<=1.51,`forward ${forward}`);
      await page.clock.runFor(500);assert.equal(await page.evaluate(()=>scenePlayer.time),forward,"Pause must not advance time");
      await page.evaluate(()=>{scenePlayer.setPlaybackRate(-1);scenePlayer.play();});await page.clock.runFor(200);await page.evaluate(()=>scenePlayer.pause());assert(await page.evaluate(()=>scenePlayer.time)<forward-.15);
      await page.evaluate(()=>scenePlayer.setPlaybackRate(1,2));await seek(30);await page.evaluate(()=>scenePlayer.play());await page.clock.runFor(500);await page.evaluate(()=>scenePlayer.pause());const half=await page.evaluate(()=>scenePlayer.time);assert(half>1.22&&half<=1.26);
      await page.evaluate(()=>scenePlayer.loadScene("/assets/animation_demo/demo.scene.json"));await page.evaluate(()=>scenePlayer.pause());await seek(60);assert.equal(await page.evaluate(()=>scenePlayer.scene.nodes.size),7);
      assert.equal(await page.locator("canvas").count(),renderer==="dom"?0:1);
      if(renderer==="dom")assert(!requests.some(url=>url.includes("babylon")),"DOM must not download Babylon");
      assert.deepEqual(errors,[]);
      await page.close();console.log(`Animation browser: ${renderer} spawn/dispose, rewind pixels, stop restoration, exact frame seek, pause, reverse and half speed passed.`);
    }
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
(async()=>{api=await import(pathToFileURL(path.join(root,"dist/runtime/player.js")));timeAndTracks();hierarchyChecks();await browserChecks();})().catch(error=>{console.error(error);process.exitCode=1;});
