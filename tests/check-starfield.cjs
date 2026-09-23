const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{pathToFileURL}=require("node:url");
const {chromium,firefox}=require("playwright"),{makeServer,root}=require("./serve.cjs"),{png,compare}=require("./pixel-check.cjs");
const output=process.env.TOKIO_CHECK_OUTPUT?path.resolve(process.env.TOKIO_CHECK_OUTPUT):null;
async function main(){
  const {Scene,Frame,Time,frameRate,Math3D:M}=await import(pathToFileURL(path.join(root,"dist/runtime/player.js")));
  const file=path.join(root,"assets/final_animation.scene.json"),data=JSON.parse(fs.readFileSync(file)),scene=new Scene(data,pathToFileURL(file).href),rate=frameRate(30);
  const sample=n=>{scene.setFrameTime(Time.fromFrame(Frame.from(n)),rate);scene.updateWorld();};
  for(const n of [547,548,615,647,705,739,773,799,800,839,846,847,850,851,853,863,900]){
    sample(n);assert.equal(scene.isActive("starfield-scene"),n>=548&&n<851);
    assert.equal(scene.isActive("starfield-wipe"),n>=800&&n<900);assert.equal(scene.component("camera","Vignette").enabled,n<548);
    if(!scene.nodes.has("starfield-scene"))continue;
    for(const [id,z] of [["flight-ship",0],["stars-back",1],["stars-front",-1],["starfield-wipe",-2]])assert.equal(scene.world.get(id)[14],z);
    for(const id of ["flight-exhaust","flight-pilot","flight-thruster"])assert.equal(scene.parents.get(id).id,"flight-ship");
    assert(scene.world.get("flight-thruster")[14]>scene.world.get("flight-exhaust")[14],"The opaque thruster sits behind its exhaust particles");
    assert.equal(scene.transformAt("flight-ship").localRotation.z,scene.transformAt("star-streams").localRotation.z);
    if(n>=851)for(const id of scene.nodes.keys())if(scene.component(id,"ParticleEmitter")&&!id.startsWith("forward-"))assert.equal(scene.particleStates(id).length,0,"Outgoing emitters are off at the hard cut");
  }
  for(const n of [548,558,580,593]){
    sample(n);
    const shipCenter=M.point(scene.world.get("flight-ship"),{x:0,y:0,z:0});
    assert(shipCenter.x<-3.2&&shipCenter.y>1.8,"The parked ship pivot is outside both reference edges");
    for(const particle of scene.particleStates("flight-exhaust")){
      const r=1.2*Math.max(Math.hypot(...particle.matrix.slice(0,3)),Math.hypot(...particle.matrix.slice(4,7)));
      assert(particle.matrix[12]+r<-3.2&&particle.matrix[13]-r>1.8,"The parked exhaust, including glow, stays beyond both reference edges");
    }
  }
  sample(730);const states=JSON.stringify(scene.particleStates("flight-exhaust"));sample(800);sample(600);sample(730);assert.equal(JSON.stringify(scene.particleStates("flight-exhaust")),states);
  for(const id of scene.nodes.keys())if(scene.component(id,"ParticleEmitter")&&id.startsWith("star-stream-"))assert.equal(scene.component(id,"ParticleEmitter").space,"local");
  const wipeMotion=data.animation.tracks['starfield-wipe-x'];assert.equal(wipeMotion.frameNumber.length,2,'The extrapolated wipe motion has exactly two linear keys');
  console.log('Starfield: depth, local motion, heading, hard cuts, two-key wipe and deterministic seeks passed.');
  const server=makeServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  if(output)fs.mkdirSync(output,{recursive:true});
  try{
    for(const [label,type,renderer] of [["dom",chromium,"dom"],["babylon",chromium,"babylon"],["firefox-dom",firefox,"dom"]]){
      const executablePath=type===chromium?[process.env.TOKIO_CHROME,chromium.executablePath()].filter(Boolean).find(fs.existsSync):undefined;
      const browser=await type.launch({executablePath,headless:true});
      try{
        const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
        if(renderer==="dom")await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error("Canvas is forbidden in DOM renderer");};});
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
        // Exercise the real audio-backed seek path, including browser media time
        // quantization. Direct Scene.setFrameTime would hide an off-by-one cut.
        const at=async n=>{
          const actual=await page.evaluate(async n=>{const {Frame,Time,frameRate}=await import("/runtime/player.js");scenePlayer.pause();await scenePlayer.seekFrame(Frame.from(n));await scenePlayer.whenIdle();return {frame:Time.key(Time.convert(scenePlayer.scene.frameTime,scenePlayer.scene.sequence.tickResolution,frameRate(30))),pose:scenePlayer.scene.component("starfield-wipe","SpriteRenderer").frame,outgoing:scenePlayer.scene.isActive("starfield-scene"),incoming:scenePlayer.scene.isActive("forward-scene")};},n);
          assert.equal(actual.frame,`${n}:0/1`,`${label}: audio-backed frame seek must be exact`);
          assert.equal(actual.outgoing,n>=548&&n<851);assert.equal(actual.incoming,n>=851&&n<1155);
          sample(n);assert.equal(actual.pose,scene.component('starfield-wipe','SpriteRenderer').frame,`${label}: audio seek selects the same atlas pose as direct frame evaluation`);
        };
        const capture=n=>page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }",...output?{path:path.join(output,`${label}_${n}.png`)}:{}});let before;
        for(const n of [548,558,580,615,630,647,700,739,773,810,839,841,842,844,845,847,848,850,851,852,853,854,857,858,860,861,863,864,700]){
          await at(n);const bytes=await capture(n);
          if(n===700){if(before){const d=compare(before,bytes);assert(d.max<=2&&d.mae<.005,"Rewind preserves particle pixels within filter rounding");}else before=bytes;}
          if(n>=851){const state=await page.evaluate(()=>({outgoing:scenePlayer.scene.isActive("starfield-scene"),incoming:scenePlayer.scene.isActive("forward-scene")}));assert.equal(state.outgoing,false);assert.equal(state.incoming,true);const im=png(bytes);assert(im.pixels.some((v,i)=>i%im.channels!==3&&v>100),"Incoming flight and foreground wipe remain visible after the hard cut");}
        }
        await at(810);const jobs=await page.evaluate(()=>scenePlayer.resources.jobs.size);await at(739);await at(810);
        assert.equal(await page.evaluate(()=>scenePlayer.resources.jobs.size),jobs,"Animated particles do not regenerate texture jobs");
        for(const viewport of [{width:375,height:812},{width:1400,height:600}]){await page.setViewportSize(viewport);await at(851);assert.equal(await page.evaluate(()=>scenePlayer.scene.isActive("starfield-scene")),false);}
        assert.deepEqual(errors,[]);console.log(`Starfield ${label}: continuous animation, deterministic rewind, foreground wipe over hard cut, responsive view and live effects passed.`);
      }finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
