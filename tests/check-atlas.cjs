const {chromium}=require("playwright"),{makeServer}=require("./serve.cjs"),{png}=require("./pixel-check.cjs");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const sourceURL="/assets/intro_sparks/sparks.scene.json",root=path.resolve(__dirname,"..");
const scene=JSON.parse(fs.readFileSync(path.join(root,sourceURL),"utf8"));
const ranges={burst_a:[0,15,2],spark_b:[16,69,3],burst_c:[31,58,2],moon_surface:[45,70,2]};
const images=Object.fromEntries(Object.entries(scene.assets).map(([id,a])=>[id,png(fs.readFileSync(path.join(root,"assets/intro_sparks",a.file)))]));
for(const [id,a] of Object.entries(scene.assets)){
  const im=images[id],range=ranges[id],p=a.atlas.padding||0;assert.equal(im.channels,4);assert.equal(im.width,(a.atlas.cellSize.x+2*p)*a.atlas.columns);assert.equal(im.height,(a.atlas.cellSize.y+2*p)*a.atlas.rows);
  assert.equal(a.atlas.frameCount,(range[1]-range[0]+1)/range[2]);
  assert(im.pixels.some((v,i)=>i%4===3&&v===0));assert(im.pixels.some((v,i)=>i%4===3&&v===255));
  assert(im.pixels.every((v,i)=>i%4!==3||v===0||v===255));
}
(async()=>{
  await require("./check-flicker.cjs").check();
  await require("./check-atlas-padding.cjs").check();
  const server=makeServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));let browser;
  try{
    const executablePath=[process.env.TOKIO_CHROME,chromium.executablePath()].filter(Boolean).find(fs.existsSync);
    browser=await chromium.launch({executablePath,headless:true});
    for(const mode of ["dom","babylon"]){
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];
      page.on("pageerror",e=>errors.push(e.message));page.on("response",r=>{if(r.status()>=400)errors.push(r.url());});
      if(mode==="dom")await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error("Canvas is forbidden");};window.OffscreenCanvas=class{constructor(){throw new Error("OffscreenCanvas is forbidden");}};});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?scene=${sourceURL}&renderer=${mode}&time=0&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
      await page.evaluate(async()=>{scenePlayer.pause();for(const node of scenePlayer.scene.nodes.values())if(scenePlayer.scene.component(node.id,"Glow"))await scenePlayer.setComponent(node.id,"Glow",{enabled:false});});
      let checks=0;
      for(let n=0;n<=72;n++){
        const states=await page.evaluate(async n=>{const {Frame,frameRate}=await import("/runtime/player.js");await scenePlayer.seekFrame(Frame.from(n),frameRate(30));await scenePlayer.whenIdle();return Object.fromEntries([...scenePlayer.scene.nodes.values()].filter(node=>scenePlayer.scene.component(node.id,"SpriteRenderer")).map(node=>[node.id,scenePlayer.scene.spriteState(node.id)]));},n);
        for(const [id,[first,last,hold]] of Object.entries(ranges)){assert.equal(states[id].visible,n>=first&&n<=last,`${mode}/${id} visibility at frame ${n}`);if(states[id].visible)assert.equal(states[id].frame,Math.floor((n-first)/hold));}
        if([0,14,16,40,55,57,69,70,71].includes(n)){
          const capture=png(await page.screenshot());
          if(n===71){assert(capture.pixels.every((v,i)=>i%capture.channels===3||v===0),"No effect survives past frame 70");continue;}
          for(const [id,state] of Object.entries(states))if(state.visible){
            const a=scene.assets[id],im=images[id],{origin,step}=a.reconstruction.grid,w=a.atlas.cellSize.x,h=a.atlas.cellSize.y;
            for(let y=0;y<h;y++)for(let x=0;x<w;x++){
              const index=((y+state.rect.y)*im.width+state.rect.x+x)*4;if(!im.pixels[index+3])continue;
              const sx=Math.floor(origin[0]+(x+.5)*step),sy=Math.floor(origin[1]+(y+.5)*step),at=(sy*capture.width+sx)*capture.channels;
              for(let c=0;c<3;c++)assert(Math.abs(capture.pixels[at+c]-im.pixels[index+c])<=2,`${mode}/${id} atlas sample at ${n}, cell ${x},${y}: ${capture.pixels[at+c]} vs ${im.pixels[index+c]}`);
              checks++;
            }
          }
        }
      }
      await page.evaluate(async()=>{const {Frame,frameRate}=await import("/runtime/player.js");await scenePlayer.seekFrame(Frame.from(57),frameRate(30));await scenePlayer.setComponent("moon_surface","Glow",{enabled:true});});
      const glow=await page.screenshot();await page.evaluate(()=>scenePlayer.setComponent("moon_surface","Glow",{enabled:false}));assert(!glow.equals(await page.screenshot()),"Atlas glow must use the selected frame");
      await page.evaluate(()=>{scenePlayer.seek(0);scenePlayer.play();});await page.waitForTimeout(140);assert(await page.evaluate(()=>scenePlayer.time>0),JSON.stringify({state:await page.evaluate(()=>({time:scenePlayer.time,playing:scenePlayer.playing})),errors}));await page.evaluate(()=>scenePlayer.pause());
      const time=await page.evaluate(()=>scenePlayer.time);await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>scenePlayer.time),time);
      assert.deepEqual(errors,[]);if(mode==="dom")assert.equal(await page.locator("canvas").count(),0);
      console.log(`${mode}: 73 source frames, four independent clocks, ${checks} atlas pixel samples, alpha, glow, play/pause passed.`);await page.close();
    }
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
