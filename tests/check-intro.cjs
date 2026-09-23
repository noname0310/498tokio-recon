const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{pathToFileURL}=require("node:url");
const {chromium}=require("playwright"),{makeServer,root}=require("./serve.cjs");
const {png,compare}=require("./pixel-check.cjs");
const output=process.env.TOKIO_CHECK_OUTPUT?path.resolve(process.env.TOKIO_CHECK_OUTPUT):null;
async function main(){
  const {Scene,Frame,Time,frameRate}=await import(pathToFileURL(path.join(root,"dist/runtime/player.js")));
  const data=JSON.parse(fs.readFileSync(path.join(root,"assets/final_animation.scene.json"))),scene=new Scene(data,pathToFileURL(path.join(root,"assets/final_animation.scene.json")).href),rate=frameRate(30);
  const at=n=>{scene.setFrameTime(Time.fromFrame(Frame.from(n)),rate);scene.updateWorld();};
  for(const n of [0,173,481,540,542,547,558]){
    at(n);
    if(n<=540)assert.equal(scene.transformAt("ship").localRotation.z,0);
    assert.equal(scene.world.get("pilot")[14],scene.world.get("intro-root")[14],"Pilot defines the opening root's zero depth plane");
    assert.equal(scene.parents.get("pilot").id,"ship");assert.equal(scene.parents.get("ship-exhaust").id,"ship");
    for(const id of scene.nodes.keys())if(id.startsWith("__sequence__")){
      assert.equal(scene.parents.get(id).id,"moon");
      const m=scene.world.get(id),moon=scene.world.get("moon");assert.equal(Math.hypot(m[0],m[1],m[2]),Math.hypot(moon[0],moon[1],moon[2]),"Flames inherit the moon pixel pitch");
    }
    if(n===547){assert.equal(scene.isActive("ship"),false);assert.equal(scene.isActive("warp-beam-0"),true);}
    if(n===558)assert.equal(scene.isActive("warp-beam-0"),false);
  }
  assert.equal(scene.parents.get("intro-scenery").id,"intro-root");assert.equal(scene.parents.get("warp-curtain").id,"intro-root");
  for(const [frame,z] of [[480,0],[481,0],[513.5,2],[546,4],[547,4],[558,4]]){
    scene.setFrameTime(Time.fromDecimal(frame),frameRate(30));scene.updateWorld();
    assert(Math.abs(scene.world.get("intro-root")[14]-z)<1e-6,"The opening root recedes linearly before the warp");
    assert(Math.abs(scene.world.get("warp-curtain")[14]-(z-2))<1e-6,"The curtain inherits the root and reaches world Z=2");
    assert.equal(scene.world.get("camera")[14],-10);assert.equal(scene.world.get("warp-beam-0")[14],-8);
  }
  for(const n of [192,198,204,300,306]){at(n);const hue=scene.component("moon","SpriteRenderer").hueDegrees;at(n+5);assert.equal(scene.component("moon","SpriteRenderer").hueDegrees,hue,"Hue holds six source frames");at(n+108);assert.equal(scene.component("moon","SpriteRenderer").hueDegrees,hue,"Hue loop is exactly 108 frames");}
  at(481);assert.equal(scene.transformAt("arrival").localPosition.y,0);at(539);assert.equal(scene.transformAt("arrival").localPosition.y,0);
  at(309);assert.equal(scene.isActive("grass-layers"),false);
  let lastY=-Infinity;
  for(const frame of [310,320,330,340,350,360,372]){
    at(frame);assert.equal(scene.isActive("grass-layers"),true);assert.equal(scene.isActive("ship"),true,"The whole arrival rig enters together");
    assert(scene.particleStates("ship-exhaust").length>0,"The exhaust accompanies the early ship entry");
    assert.equal(scene.parents.get("ship").id,scene.parents.get("grass-layers").id,"Ship and grass share the cubic parent motion");
    const y=scene.world.get("grass-layers")[13];assert(y>lastY,"Grass rises monotonically into the existing arrival");lastY=y;
  }
  const grassY=frame=>{scene.setFrameTime(Time.fromDecimal(frame),frameRate(30));scene.updateWorld();return scene.world.get("grass-layers")[13];};
  const joinY=grassY(372),incoming=(joinY-grassY(371.99))/.01,outgoing=(grassY(372.01)-joinY)/.01;
  assert(Math.abs(incoming-outgoing)<.002,"The cubic joins the original vertical velocity without a speed jump");
  at(372);const linearStart=scene.transformAt("arrival").localPosition.y;
  for(const frame of [372,400,481,546]){at(frame);assert.equal(scene.transformAt("grass-layers").localPosition.y,0);assert(Math.abs(scene.transformAt("arrival").localPosition.y-linearStart*Math.max(0,(481-frame)/(481-372)))<1e-6,"Original linear arrival resumes from frame 372");}
  for(const id of ["grass-far","grass-back","grass-middle","grass-front"]){at(520);const x=scene.transformAt(id).localPosition.x;at(521);const dx=scene.transformAt(id).localPosition.x-x;at(528);const later=scene.transformAt(id).localPosition.x;at(529);assert(Math.abs(scene.transformAt(id).localPosition.x-later-dx)<1e-5,"Grass has constant scrolling velocity");at(541);const stop=scene.transformAt(id).localPosition.x;at(546);assert.equal(scene.transformAt(id).localPosition.x,stop);}
  const view={width:640,height:360,worldWidth:6.4,worldHeight:3.6,aspect:16/9,pixelsPerUnit:100,dpr:1};
  for(const angle of [0,45,89,89.9999,90,90.0001]){
    scene.setTransform("camera",{localRotation:{y:angle}});const b=scene.coverage("reveal-curtain",view);
    if(b)assert(Object.values(b).every(v=>Number.isFinite(v)&&Math.abs(v)<1000),"Finite frustum bounds at grazing angles");
  }
  const server=makeServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const origin=`http://127.0.0.1:${server.address().port}`,executablePath=[chromium.executablePath()].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,executablePath});
  if(output)fs.mkdirSync(output,{recursive:true});
  try{for(const renderer of ["dom","babylon"]){
    const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
    if(renderer==="dom")await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error("Canvas forbidden in DOM renderer");};});
    await page.goto(`${origin}/index.html?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
    // Exact analysis samples bypass media seek quantization while preserving the
    // authored audio clock in the delivered scene.
    const sample=n=>page.evaluate(async n=>{const {Frame,Time,frameRate}=await import("/runtime/player.js");scenePlayer.pause();scenePlayer.scene.setFrameTime(Time.fromFrame(Frame.from(n)),frameRate(30));scenePlayer.time=n/30;await scenePlayer.update();await scenePlayer.whenIdle();},n);
    const capture=name=>page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }",...output?{path:path.join(output,`${renderer}_${name}.png`)}:{}});
    let repeat,repeatState;
    for(const n of [0,76,120,173,300,360,400,450,481,530,540,542,547,550,553,558,173]){
      await sample(n);const bytes=await capture(String(n).padStart(6,"0"));
      if(n===173){
        const state=await page.evaluate(()=>{const scene=scenePlayer.scene;return {time:scene.time,entities:[...scene.nodes.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(n=>({id:n.id,world:scene.world.get(n.id),active:scene.isActive(n.id),components:n.components.map(c=>scene.component(n.id,c.type))}))};});
        if(repeat){
          assert.deepEqual(state,repeatState,"Exact rewind must reproduce all evaluated renderer inputs");
          // Retained SVG filter surfaces can round a few blended channels by
          // 1-2 levels. Pose, palette, effects and particle state remain exact.
          const difference=compare(bytes,repeat);assert(difference.max<=2&&difference.mae<.0001,"Rewind must preserve the rendered image within filter rounding");
        }else{repeat=bytes;repeatState=state;}
      }
      if(n===547){const p=png(bytes),i=(23*p.width+112)*p.channels;assert([...p.pixels.subarray(i,i+3)].every(v=>v>248),"Warp beams render in front of the vignette");}
      if(n===558)assert.equal(await page.evaluate(()=>scenePlayer.scene.isActive("warp-beam-0")),false,"The beam is gone while the next star field remains visible");
    }
    assert.equal(await page.evaluate(()=>scenePlayer.audioPlayer.element.preservesPitch),false);
    for(const frame of [500,530,546]){
      await sample(frame);const moved=await capture(`depth_${frame}`);
      await page.evaluate(async()=>{scenePlayer.scene.sequence.tracks.get("intro-depth").value.fill(0);await scenePlayer.update();});
      const difference=compare(moved,await capture(`depth_baseline_${frame}`));
      assert(difference.max<=2&&difference.mae<.001,`Depth-only motion must preserve orthographic pixels: ${JSON.stringify(difference)}`);
      await page.evaluate(async()=>{scenePlayer.scene.sequence.tracks.get("intro-depth").value.set([0,4]);await scenePlayer.update();});
    }
    for(const size of [{width:375,height:812},{width:1400,height:360}]){
      await page.setViewportSize(size);await sample(0);
      const p=png(await capture(`${size.width}_black`));
      for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)if(x===0||y===0||x===p.width-1||y===p.height-1){const i=(y*p.width+x)*p.channels;assert(p.pixels.subarray(i,i+3).every(v=>v===0),"Black plane covers every viewport edge");}
      assert.equal(await page.evaluate(()=>scenePlayer.scene.component("reveal-curtain","PlaneRenderer").color.a),1);
      if(size.height>size.width){
        const changed=[];
        for(const frame of [310,341,372]){
          await sample(frame);const visible=await capture(`portrait_grass_${frame}`);
          await page.evaluate(()=>scenePlayer.setActive("grass-layers",false));const hidden=await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"});
          const diff=compare(visible,hidden);changed.push(diff.mae);
          await page.evaluate(()=>scenePlayer.setActive("grass-layers",true));
        }
        assert(changed[0]<.001,"Grass begins below the portrait viewport rather than appearing inside it");
        assert(changed[1]>.05&&changed[2]>changed[1],"The cubic reveals progressively more grass before the original animation");
      }
    }
    await page.setViewportSize({width:640,height:360});await sample(530);
    await page.evaluate(async()=>{await scenePlayer.addEntity("final-animation",{id:"blur-study",transform:{localPosition:{z:-7.1}},components:[{type:"TiledSpriteRenderer",asset:"grass",origin:{x:0,y:1.8}},{type:"DirectionalBlur",sigmaWorld:0}]});await scenePlayer.whenIdle();});
    const before=await page.evaluate(()=>scenePlayer.resources.jobs.size);
    const sharp=await capture("blur_sharp");
    await page.evaluate(async()=>{await scenePlayer.setComponent("blur-study","DirectionalBlur",{sigmaWorld:.08,angleDegrees:25});});
    const diagonal=await capture("blur_diagonal");assert(compare(sharp,diagonal).mae>.2,"Live blur visibly changes the image");
    await page.evaluate(async()=>{await scenePlayer.setComponent("blur-study","DirectionalBlur",{sigmaWorld:.03,angleDegrees:0});});
    assert(compare(diagonal,await capture("blur_horizontal")).mae>.1,"Changing blur direction and radius changes the image");
    assert.equal(await page.evaluate(()=>scenePlayer.resources.jobs.size),before,"Live blur cannot create texture jobs");
    assert.deepEqual(errors,[]);await page.evaluate(()=>scenePlayer.dispose());await page.close();
    console.log(`Intro ${renderer}: depth/parenting, exact sampling/rewind, dynamic aspect coverage, live blur and render captures passed.`);
  }}finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
