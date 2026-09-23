const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {chromium,firefox}=require("playwright"),{makeServer}=require("./serve.cjs"),{png,compare}=require("./pixel-check.cjs");
function pixel(buffer,x,y){const im=png(buffer),i=(y*im.width+x)*im.channels;return [...im.pixels.subarray(i,i+3)];}
function bright(buffer){const im=png(buffer);let count=0;for(let i=0;i<im.pixels.length;i+=im.channels)if(Math.max(...im.pixels.subarray(i,i+3))>50)count++;return count;}
function close(a,b,message){const d=compare(a,b);assert(d.max<=2&&d.mae<.001,`${message}: ${JSON.stringify(d)}`);}
function fixture(){return {schemaVersion:1,assets:{},root:{id:"stage",children:[
  {id:"camera",transform:{localPosition:{x:.25,z:-10}},components:[{type:"Camera",referenceVerticalSize:3.6}]},
  {id:"group",children:[{id:"beam",components:[{type:"LineRenderer",start:{x:-1,y:0},end:{x:1,y:0},width:.2,color:{r:1,g:0,b:0,a:1}},{type:"Glow",color:{r:1,g:0,b:0,a:1},sigmaWorld:.1,threshold:0,softness:1,intensity:3}]}]},
  {id:"backdrop",transform:{localPosition:{z:1}},components:[{type:"PlaneRenderer",coverage:"fixed",size:{x:3,y:3},color:{r:.05,g:.1,b:.2,a:1}}]}
]}};}
async function main(){
  const server=makeServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin=`http://127.0.0.1:${server.address().port}`;
  try{for(const [name,type] of [["chromium",chromium],["firefox",firefox]]){
    const executablePath=name==="chromium"?[process.env.TOKIO_CHROME,chromium.executablePath()].filter(Boolean).find(fs.existsSync):undefined;
    const browser=await type.launch({headless:true,executablePath});
    try{
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error("DOM canvas forbidden");};});
      await page.goto(`${origin}/index.html?renderer=dom&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
      const sample=frame=>page.evaluate(async frame=>{const {Frame,Time,frameRate}=await import("/runtime/player.js");scenePlayer.pause();scenePlayer.scene.setFrameTime(Time.fromFrame(Frame.from(frame)),frameRate(30));scenePlayer.time=frame/30;await scenePlayer.update();},frame);
      const cold=await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"});assert(bright(cold)>10,"The first flame must be visible immediately after loading");
      for(const frame of [8,45,173,481,542,547,558]){
        await sample(frame);const image=await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"});
        assert(await page.evaluate(()=>document.querySelectorAll(".scene-world .entity").length===0&&[...document.querySelectorAll(".scene-world .component")].every(e=>e.parentElement===scenePlayer.renderer.world)),"Only flat render surfaces belong in the render root");
        if(frame<=45){assert(bright(image)>100,"Opening flames must appear over the black curtain");assert.deepEqual(pixel(image,320,180),[0,0,0],"The moon stays behind the opaque curtain");}
        if(frame===547)assert(pixel(image,112,23).every(v=>v>248),"Warp lines stay in front of the vignette");
        if(frame===558){
          assert.equal(await page.evaluate(()=>scenePlayer.scene.isActive("warp-beam-0")),false,"The warp has ended");
          assert.equal(await page.evaluate(()=>scenePlayer.scene.isActive("starfield-scene")),true,"The incoming star field remains visible");
          assert(bright(image)>50,"Stars render over the black background after the beams end");
        }
      }
      await sample(8);const front=await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"});
      await page.evaluate(()=>scenePlayer.setTransform("reveal-curtain",{localPosition:{z:1}}));assert.equal(bright(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"})),0,"Moving the curtain in front must hide the flames and their glow");
      await page.evaluate(()=>scenePlayer.setTransform("reveal-curtain",{localPosition:{z:3}}));close(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),front,"Restoring depth restores the flame");
      await page.evaluate(()=>{const root=scenePlayer.renderer.world;for(const e of [...root.children].reverse())root.append(e);});close(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),front,"Depth order is independent of DOM insertion order");
      await sample(0);close(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),cold,"Rewinding restores the first flame");
      await page.evaluate(async()=>{await scenePlayer.seek(0);scenePlayer.setPlaybackRate(1,4);await scenePlayer.play();});
      await page.waitForFunction(()=>scenePlayer.time>.1);assert(bright(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}))>10,"Flames remain visible during audio-clock playback");await page.evaluate(()=>scenePlayer.pause());
      await page.evaluate(data=>scenePlayer.loadScene(data),fixture());
      const image=await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"});assert.deepEqual(pixel(image,320,180),[255,0,0],"The nearer beam covers the later-created backdrop");
      const halo=pixel(image,320,165);assert(halo[0]>18&&Math.abs(halo[1]-26)<=1&&Math.abs(halo[2]-51)<=1,`Glow must add red without attenuating backdrop green/blue: ${halo}`);
      const reuse=await page.evaluate(async()=>{
        const root=scenePlayer.renderer.world,surfaces=[...root.children],records=[],observer=new MutationObserver(r=>records.push(...r));observer.observe(root,{subtree:true,childList:true});
        await scenePlayer.setTransform("group",{localPosition:{z:2}});await Promise.resolve();observer.disconnect();
        return surfaces.every(e=>e.parentElement===root)&&records.length===0&&!document.querySelector('[data-entity="group"]');
      });assert(reuse,"Reparenting/moving a logical group cannot create a DOM wrapper or replace surfaces");
      assert.deepEqual(pixel(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),320,180),[13,26,51],"The opaque backdrop covers the beam and glow after crossing depth");
      await page.evaluate(()=>scenePlayer.setTransform("camera",{localPosition:{z:10},localRotation:{y:180}}));
      assert.deepEqual(pixel(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),320,180),[255,0,0],"Camera-space ordering reverses when the camera turns around");
      const writes=await page.evaluate(async()=>{const records=[],observer=new MutationObserver(r=>records.push(...r));observer.observe(scenePlayer.renderer.world,{subtree:true,attributes:true,childList:true});await scenePlayer.update();await Promise.resolve();observer.disconnect();return records.length;});assert.equal(writes,0,"An unchanged frame produces no DOM writes");
      const zWrites=await page.evaluate(async()=>{const original=CSSStyleDeclaration.prototype.setProperty;let writes=0;CSSStyleDeclaration.prototype.setProperty=function(name,...args){if(name==="z-index")writes++;return original.call(this,name,...args);};try{await scenePlayer.setTransform("group",{localPosition:{x:.1}});return writes;}finally{CSSStyleDeclaration.prototype.setProperty=original;}});assert.equal(zWrites,0,"Motion at fixed view depth does not rewrite depth ranks");
      assert.deepEqual(errors,[]);await page.evaluate(()=>scenePlayer.dispose());await page.close();
      console.log(`DOM ${name}: cold opening/rewind, flat retained surfaces, view-depth occlusion, additive glow, camera reversal and unchanged-frame writes passed.`);
    }finally{await browser.close();}
  }}finally{await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
