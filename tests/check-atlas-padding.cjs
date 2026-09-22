const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {pathToFileURL}=require("node:url"),{chromium,firefox}=require("playwright");
const {makeServer,root}=require("./serve.cjs"),{png,compare}=require("./pixel-check.cjs");
const asset={type:"Sprite",file:"/tests/fixtures/padded_atlas.png",size:{x:10,y:14},pixelsPerUnit:10,pivot:{x:.3,y:.8},filter:"point",atlas:{cellSize:{x:3,y:5},columns:2,rows:2,frameCount:4,padding:1}};
const colors=[[1,0,0],[0,1,0],[0,0,1],[1,1,0]];
function fixture(particle=false){return {schemaVersion:1,timeline:{autoplay:false},assets:{art:structuredClone(asset)},root:{id:"root",children:[
  {id:"camera",transform:{localPosition:{z:-10}},components:[{type:"Camera",referenceVerticalSize:3.6}]},
  {id:"art",components:[particle?{type:"ParticleEmitter",asset:"art",rate:0,bursts:[{time:0,count:1}],speed:{min:0,max:0},startSize:{min:.5,max:.5},lifetime:{min:10,max:10},billboard:"local",animation:{mode:"single",frame:0}}:{type:"SpriteRenderer",asset:"art"}]}
]}};}
function alignmentFixture(particle){
  const data=fixture(particle);data.assets.art={type:"Sprite",file:"/tests/fixtures/atlas_alignment.png",size:{x:95,y:29},pixelsPerUnit:100,pivot:{x:.5,y:.5},filter:"point",atlas:{cellSize:{x:17,y:27},columns:5,rows:1,frameCount:5,padding:1}};
  const node=data.root.children[1];node.transform={localScale:{x:6.0114,y:6.0114,z:1},localPosition:{x:.0123,y:.0456}};
  node.components.push({type:"Flicker",enabled:false});
  if(particle)node.components[0].startSize={min:.27,max:.27};return data;
}
function validateAssets(){
  const seen=new Set();
  for(const directory of fs.readdirSync(path.join(root,"assets"),{withFileTypes:true}).filter(d=>d.isDirectory())){
    const folder=path.join(root,"assets",directory.name);
    for(const file of fs.readdirSync(folder).filter(f=>f.endsWith(".scene.json"))){
      const data=JSON.parse(fs.readFileSync(path.join(folder,file),"utf8"));
      for(const a of Object.values(data.assets))if(a.atlas){
        const file=path.resolve(folder,a.file),im=png(fs.readFileSync(file)),{cellSize,columns,rows,padding:p}=a.atlas;
        assert.equal(p,1,`${file}: final assets require one texel per side`);assert.equal(im.width,a.size.x);assert.equal(im.height,a.size.y);
        assert.equal(im.width,columns*(cellSize.x+2*p));assert.equal(im.height,rows*(cellSize.y+2*p));
        if(seen.has(file))continue;seen.add(file);
        for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){
          const cx=x%(cellSize.x+2*p),cy=y%(cellSize.y+2*p);
          if(cx<p||cy<p||cx>=p+cellSize.x||cy>=p+cellSize.y)assert.equal(im.pixels[(y*im.width+x)*4+3],0,`${file}: transparent gutter at ${x},${y}`);
        }
      }
    }
  }
  assert(seen.size>=10);console.log(`Atlas padding: ${seen.size} assets and all scene references have transparent gutters.`);
}
async function check(){
  validateAssets();
  const {Scene}=await import(pathToFileURL(path.join(root,"dist/runtime/player.js")));
  const scene=new Scene(fixture(),"http://localhost/"),particles=new Scene(fixture(true),"http://localhost/");
  for(let frame=0;frame<4;frame++){
    scene.setComponent("art","SpriteRenderer",{frame});particles.setComponent("art","ParticleEmitter",{animation:{frame}});
    const rect={x:1+(frame%2)*5,y:1+Math.floor(frame/2)*7,width:3,height:5};
    assert.deepEqual(scene.spriteState("art").rect,rect);assert.deepEqual(scene.spriteState("art").size,{x:3,y:5});
    assert.deepEqual(particles.particleStates("art",.1)[0].rect,{x:rect.x/10,y:rect.y/14,width:.3,height:5/14});
  }
  for(const padding of [-1,.5,Infinity]){const bad=fixture();bad.assets.art.atlas.padding=padding;assert.throws(()=>new Scene(bad,"http://localhost/"),/padding/);}
  const missing=fixture();delete missing.assets.art.atlas.padding;assert.throws(()=>new Scene(missing,"http://localhost/"),/does not fit/);
  const server=makeServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    for(const [name,type,renderer] of [["Chromium DOM",chromium,"dom"],["Firefox DOM",firefox,"dom"],["Chromium Babylon",chromium,"babylon"]]){
      const executablePath=type===chromium?[process.env.TOKIO_CHROME,chromium.executablePath()].filter(Boolean).find(fs.existsSync):undefined;
      const browser=await type.launch({executablePath,headless:true});
      try{
        const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on("pageerror",error=>errors.push(error.message));
        if(renderer==="dom")await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error("DOM canvas forbidden");};});
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html?renderer=${renderer}&scene=assets/starfield/starfield.scene.json&time=0&controls=0`);
        await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.pause());
        for(const particle of [false,true]){
          await page.evaluate(data=>scenePlayer.loadScene(data),fixture(particle));await page.evaluate(()=>scenePlayer.seek(.1));
          for(let frame=0;frame<4;frame++){
            await page.evaluate(async({frame,particle})=>{
              const scale=[1.37,.83,1.13,2.21][frame],angle=[37.2,-17.4,0,89.1][frame];
              await scenePlayer.setComponent("art",particle?"ParticleEmitter":"SpriteRenderer",particle?{animation:{frame}}:{frame});
              await scenePlayer.setTransform("art",{localPosition:{x:.0013,y:.0071,z:0},localScale:{x:scale,y:scale,z:1},localRotation:{z:angle}});
              await scenePlayer.whenIdle();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            },{frame,particle});
            const im=png(await page.screenshot());let bright=0;
            for(let i=0;i<im.width*im.height;i++){
              const rgb=[0,1,2].map(c=>im.pixels[i*im.channels+c]),level=Math.max(...rgb);if(level>16)bright++;
              for(let c=0;c<3;c++)assert(Math.abs(rgb[c]-colors[frame][c]*level)<=2,`${name} ${particle?"particle":"sprite"} frame ${frame}: neighboring frame leaked at pixel ${i}`);
            }
            assert(bright>300,`${name}: selected content is visible`);
          }
        }
        await page.setViewportSize({width:1366,height:768});
        for(const particle of [false,true]){
          await page.evaluate(data=>scenePlayer.loadScene(data),alignmentFixture(particle));await page.evaluate(()=>scenePlayer.seek(.1));
          const caches=await page.evaluate(()=>({frames:scenePlayer.resources.atlasFrames.size,urls:scenePlayer.resources.urls.size,jobs:scenePlayer.resources.jobs.size}));
          for(const angle of [0,37.2]){
            await page.evaluate(angle=>scenePlayer.setTransform("art",{localRotation:{z:angle}}),angle);let reference;
            for(const frame of [0,1,2,3,4,1,0]){
              await page.evaluate(async({frame,particle})=>{await scenePlayer.setComponent("art",particle?"ParticleEmitter":"SpriteRenderer",particle?{animation:{frame}}:{frame});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},{frame,particle});
              const shot=await page.screenshot();
              if(reference)assert.deepEqual(compare(shot,reference),{max:0,mae:0},`${name}: identical native content cannot shift with atlas frame (${particle?"particle":"sprite"}, ${angle} degrees, ${frame})`);
              else reference=shot;
            }
          }
          assert.deepEqual(await page.evaluate(()=>({frames:scenePlayer.resources.atlasFrames.size,urls:scenePlayer.resources.urls.size,jobs:scenePlayer.resources.jobs.size})),caches,"Playback reuses all prepared cell images");
          await page.evaluate(()=>scenePlayer.setComponent("art","Flicker",{enabled:true,frequency:15,dutyCycle:.5}));
          for(const frame of [0,1,2,7,0]){
            const active=await page.evaluate(async frame=>{scenePlayer.pause();const {Frame,frameRate}=await import("/runtime/player.js");await scenePlayer.seekFrame(Frame.from(frame),frameRate(30));return scenePlayer.scene.active.get("art");},frame);
            assert.equal(active,frame%2===0);
            const im=png(await page.screenshot()),visible=im.pixels.some((v,i)=>i%im.channels<3&&v>32);assert.equal(visible,active,`${name}: Flicker gates the rendered ${particle?"particle":"sprite"}`);
          }
          const atlasImage=await page.screenshot(),standalone=alignmentFixture(particle);
          standalone.assets.art.file="/tests/fixtures/atlas_alignment_cell.png";standalone.assets.art.size={x:17,y:27};delete standalone.assets.art.atlas;
          standalone.root.children[1].transform.localRotation={z:37.2};
          await page.evaluate(async data=>{await scenePlayer.loadScene(data);await scenePlayer.seek(0);},standalone);
          assert.deepEqual(compare(atlasImage,await page.screenshot()),{max:0,mae:0},`${name}: atlas content matches the standalone PNG at the same pose`);
        }
        assert.deepEqual(errors,[]);console.log(`${name}: multi-row selection, no neighboring colors, identical content stays pixel-identical across frames at fractional scale and rotation; cached images reused.`);
      }finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
}
module.exports={check};
if(require.main===module)check().catch(error=>{console.error(error);process.exitCode=1;});
