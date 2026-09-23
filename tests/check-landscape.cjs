const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
function checkRepeat(buffer,view,asset,mode,position){
  const shot=png(buffer),tile=png(fs.readFileSync(path.join(root,'assets/paper_landscape/ground_tile.png'))),ppu=view.pixelsPerUnit;
  let checked=0,bad=0,first;
  for(let y=2;y<shot.height-2;y++)for(let x=2;x<shot.width-2;x++){
    const wx=(x+.5)/ppu-view.worldWidth/2-position.x,wy=view.worldHeight/2-(y+.5)/ppu-position.y;
    const ux=wx*asset.pixelsPerUnit,uy=-wy*asset.pixelsPerUnit;
    const fx=((ux%1)+1)%1,fy=((uy%1)+1)%1;
    if(Math.min(fx,1-fx,fy,1-fy)*ppu/asset.pixelsPerUnit<1.05)continue;
    const tx=((Math.floor(ux)%tile.width)+tile.width)%tile.width,ty=((Math.floor(uy)%tile.height)+tile.height)%tile.height;
    const expected=mode==='repeatBottom'&&uy<0?[37,73,109]:Array.from(tile.pixels.subarray((ty*tile.width+tx)*tile.channels,(ty*tile.width+tx)*tile.channels+3));
    const i=(y*shot.width+x)*shot.channels;checked++;
    if(expected.some((v,c)=>Math.abs(v-shot.pixels[i+c])>1)){bad++;first??={x,y,expected,actual:Array.from(shot.pixels.subarray(i,i+3))};}
  }
  assert(checked>1000);assert.equal(bad,0,`Repeat coverage/color mismatch: ${JSON.stringify({mode,bad,first})}`);
}
async function main(){
  const {Scene,Frame,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
  const file='assets/final_animation.scene.json',data=read(file),scene=new Scene(data,pathToFileURL(path.join(root,file)).href);
  const at=n=>{scene.setFrameTime(Time.fromFrame(Frame.from(n)),frameRate(30));scene.updateWorld();};
  for(const n of [1219,1220,1680,1219,1400]){at(n);assert.equal(scene.isActive('landscape-scene'),n>=1220);if(n>=1220)assert.equal(scene.isActive('paper-scene'),false);}
  assert.equal(scene.parents.get('landscape-camera-layers').id,'landscape-camera');
  for(const id of ['landscape-sky','landscape-cloud_large','landscape-cloud_left','landscape-cloud_right','landscape-pinwheel'])assert.equal(scene.parents.get(id).id,'landscape-camera-layers');
  assert.equal(scene.world.get('landscape-sky')[14],2);
  for(const id of ['cloud_large','cloud_left','cloud_right'])assert.equal(scene.world.get(`landscape-${id}`)[14],1,'All clouds share depth 1');
  const tiles=['landscape-ground_tile','landscape-grass_tile'];at(1470);
  const floorPositions=tiles.map(id=>scene.world.get(id)[12]);
  for(const n of [1470,1500,1680,1726,1219,1386]){
    at(n);assert.equal(scene.cameraNode.id,n<1220?'camera':'landscape-camera');
    assert(Math.abs(scene.world.get(scene.cameraNode.id)[12]-.05*Math.max(0,Math.min(n,1726)-1470))<1e-6);
    if(n>=1220)tiles.forEach((id,i)=>assert.equal(scene.world.get(id)[12],floorPositions[i],'Floor remains stationary in world space'));
    else for(const id of tiles)assert(!scene.nodes.has(id),'Floor is owned by the landscape sequence');
    if(n>=1220)assert(Math.abs(scene.world.get('landscape-sky')[12]-scene.world.get(scene.cameraNode.id)[12])<1e-9,'Sky inherits camera translation');
  }
  at(1500);const gateX=scene.world.get('landscape-gate')[12],cameraX=scene.world.get(scene.cameraNode.id)[12];at(1510);
  const gateDelta=(scene.world.get('landscape-gate')[12]-gateX)*100/10,cameraDelta=(scene.world.get(scene.cameraNode.id)[12]-cameraX)*100/10;
  assert(Math.abs(gateDelta-cameraDelta+4.441319910703365)<.0001,'Gate retains its distinct screen velocity');
  const characters=[...scene.nodes.keys()].filter(id=>id==='landscape-adult'||id.startsWith('landscape-child-')||id.startsWith('landscape-runner-'));
  for(const id of characters)assert.equal(scene.world.get(id)[14],0,'Character depth is reset after the camera cut');
  assert.equal(scene.component('landscape-gate','SpriteRenderer').asset,'landscape_gate');
  assert.equal(scene.world.get('landscape-gate')[14],.3,'The intact gate sits behind every character');
  assert(!scene.nodes.has('landscape-gate-front')&&!scene.nodes.has('landscape-gate-interior'),'Gate has no separate foreground or interior');
  const gateArt=png(fs.readFileSync(path.join(root,'assets/paper_landscape/gate.png')));
  assert.equal(gateArt.pixels[(25*gateArt.width+13)*gateArt.channels+3],255,'The original doorway stays opaque');
  for(const [index,frame]of [[8,1669],[7,1682],[6,1696],[5,1709]]){
    for(const n of [frame-1,frame,frame+1,frame-1]){at(n);assert.equal(scene.isActive(`landscape-runner-${index}`),n<frame,`Runner ${index} disappears as a whole sprite at ${frame}, including reverse seeks`);}
  }
  at(1367);const low=scene.world.get('landscape-paper')[13];at(1368);assert(Math.abs((scene.world.get('landscape-paper')[13]-low)*100-10.07)<.1);
  const flight={"x":{"velocity":-3.566451750778741},"y":{"velocity":-0.8074477356313429}};let previousPaper;
  for(let n=1454;n<=1726;n++){
    at(n);const paper=scene.world.get('landscape-paper'),camera=scene.world.get(scene.cameraNode.id);
    const sample={x:paper[12]*100,y:paper[13]*100,screenX:(paper[12]-camera[12])*100};
    if(previousPaper){
      assert(Math.abs(sample.x-previousPaper.x-flight.x.velocity)<.001,`Paper keeps its measured leftward world velocity at ${n}`);
      assert(Math.abs(sample.y-previousPaper.y+flight.y.velocity)<.001,`Paper keeps its measured upward world velocity at ${n}`);
      const screenVelocity=flight.x.velocity-(n>1470?5:0);
      assert(Math.abs(sample.screenX-previousPaper.screenX-screenVelocity)<.001,`Camera travel accelerates paper's leftward screen motion at ${n}`);
    }
    previousPaper=sample;
  }
  const landscapePose=()=>JSON.stringify([...scene.world].filter(([id])=>id.startsWith('landscape-')));
  at(1726);const ending=landscapePose();at(1800);assert(!scene.nodes.has('landscape-scene'),'Retired landscape is despawned');
  assert.equal(scene.isActive('landscape-scene'),false,'The new camera cut retires the landscape hierarchy');
  at(1726);assert.equal(landscapePose(),ending,'Re-entering the landscape recreates its exact pose');
  const asset={...data.assets.landscape_ground_tile,file:'/assets/paper_landscape/ground_tile.png',pixelsPerUnit:12.5};
  const fixture={schemaVersion:1,assets:{tile:asset},root:{id:'root',children:[
    {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6,clearColor:{r:37/255,g:73/255,b:109/255,a:1}}]},
    {id:'tile',transform:{localPosition:{x:.137,y:-.321}},components:[{type:'TiledSpriteRenderer',asset:'tile',wrap:{x:'repeat',y:'repeatBottom'}}]}
  ]}};
  const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const output=path.join(root,'test-results/landscape_motion');
  try{for(const [name,type,renderer] of [['dom',chromium,'dom'],['babylon',chromium,'babylon'],['firefox',firefox,'dom']]){
    const executablePath=type===chromium?[chromium.executablePath()].find(fs.existsSync):undefined;
    const browser=await type.launch({headless:true,executablePath});
    try{
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
      if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden in DOM');};});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
      let baseline;
      for(const n of [1219,1220,1367,1368,1500,1668,1669,1681,1682,1680,1400,1680]){
        await page.evaluate(async n=>{const {Frame}=await import('/runtime/player.js');await scenePlayer.seekFrame(Frame.from(n));await scenePlayer.whenIdle();},n);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const shot=await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }",path:path.join(output,`${name}_${n}.png`)});
        if(n===1680){if(baseline)assert(compare(baseline,shot).mae<.001,'Scene is deterministic after reverse seek');else baseline=shot;}
      }
      for(const viewport of [{width:390,height:844},{width:1280,height:360}]){
        await page.setViewportSize(viewport);await page.waitForFunction(v=>scenePlayer.view.width===v.width&&scenePlayer.view.height===v.height,viewport);
        await page.evaluate(()=>scenePlayer.whenIdle());await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }",path:path.join(output,`${name}_${viewport.width}.png`)});
      }
      const flightOutput=path.join(output,'paper_flight');fs.mkdirSync(flightOutput,{recursive:true});
      for(const n of [1470,1480,1500]){
        await page.evaluate(async n=>{const {Frame}=await import('/runtime/player.js');await scenePlayer.seekFrame(Frame.from(n));await scenePlayer.whenIdle();},n);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }",path:path.join(flightOutput,`${name}_after_${n}.png`)});
      }
      await page.evaluate(async fixture=>{await scenePlayer.loadScene(fixture);await scenePlayer.whenIdle();},fixture);
      for(const viewport of [{width:640,height:360},{width:390,height:844},{width:1280,height:360}]){
        await page.setViewportSize(viewport);await page.waitForFunction(v=>scenePlayer.view.width===v.width&&scenePlayer.view.height===v.height,viewport);
        for(const mode of ['repeatBottom','repeat'])for(const position of [{x:.137,y:-.321},{x:-7.431,y:.179}]){
          const view=await page.evaluate(async({mode,position})=>{await scenePlayer.setComponent('tile','TiledSpriteRenderer',{wrap:{x:'repeat',y:mode}});await scenePlayer.setTransform('tile',{localPosition:position});await scenePlayer.whenIdle();return scenePlayer.view;},{mode,position});
          checkRepeat(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),view,asset,mode,position);
        }
      }
      if(renderer==='dom'){
        const mutations=await page.evaluate(async()=>{let changes=0;const observer=new MutationObserver(r=>changes+=r.length);observer.observe(scenePlayer.viewport,{subtree:true,childList:true,attributes:true});await scenePlayer.update();await scenePlayer.whenIdle();changes+=observer.takeRecords().length;observer.disconnect();return changes;});assert.equal(mutations,0,'Unchanged tiles produce no DOM writes');
        assert(await page.locator('[data-entity="tile"] use').count()>0,'Vertical repeats share retained SVG strips');
      }
      assert.deepEqual(errors,[]);console.log(`${name}: scene cut, pickup step, reverse seek, ultrawide paper flight, responsive floor repetition, clipping and retained geometry passed.`);
    }finally{await browser.close();}
  }}finally{await new Promise(r=>server.close(r));}

}
main().catch(e=>{console.error(e);process.exitCode=1;});
