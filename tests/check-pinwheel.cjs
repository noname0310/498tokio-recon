const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const output=path.join(root,'test-results/landscape_motion/transition');
const color=[25.5,102,51],step=80/3;
function pixel(im,x,y){return [...im.pixels.subarray((y*im.width+x)*im.channels,(y*im.width+x)*im.channels+3)];}
function isColor(actual,expected){return expected.every((v,c)=>Math.abs(v-actual[c])<=2);}
function checkJoins(bytes,view,full=false){
  const im=png(bytes),u=view.pixelsPerUnit*view.dpr,s=step/100;let checked=0,outside=0;
  const centre=(x,y)=>pixel(im,Math.max(0,Math.min(im.width-1,Math.floor((x+view.worldWidth/2)*u))),Math.max(0,Math.min(im.height-1,Math.floor((view.worldHeight/2-y)*u))));
  for(let y=2;y<im.height-2;y++)for(let x=2;x<im.width-2;x++){
    const wx=(x+.5)/u-view.worldWidth/2,wy=view.worldHeight/2-(y+.5)/u;
    const i=Math.floor(wx/s),j=Math.floor(wy/s),classes=[];
    // Only omit a real covered/uncovered boundary. Shared covered-cell joins
    // must be the exact half-opacity color, including fractional grid edges.
    for(const yy of [j-1,j,j+1])for(const xx of [i-1,i,i+1])classes.push(isColor(centre((xx+.5)*s,(yy+.5)*s),color));
    if(!full&&classes.some(v=>v!==classes[0]))continue;
    const expected=full||classes[0]?color:[0,0,0];checked++;
    assert(isColor(pixel(im,x,y),expected),`Tile seam or alpha overlap at ${x},${y}`);
    if(classes[0]&&(Math.abs(wx)>3.2||Math.abs(wy)>1.8))outside++;
  }
  assert(checked>1000);if(view.worldWidth>7||view.worldHeight>4)assert(outside>1000,'Geometry extends outside the reference frame');
}
async function main(){
  fs.mkdirSync(output,{recursive:true});
  const {Scene,Frame,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
  const data=read('assets/final_animation.scene.json');
  const scene=new Scene(data,pathToFileURL(path.join(root,'assets/final_animation.scene.json')).href);
  const authored=scene.component('landscape-pinwheel','Transition');
  const at=n=>{scene.setFrameTime(Time.fromFrame(Frame.from(n)),frameRate(30));scene.updateWorld();return scene.component('landscape-pinwheel','Transition').progress;};
  at(1706);assert.equal(scene.active.get('landscape-pinwheel'),false);assert.equal(at(1721),1);at(1707);assert.equal(scene.active.get('landscape-pinwheel'),true);
  const frames=Array.from({length:21},(_,i)=>1706+i),evidence=new Map();
  const camera={id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]};
  const plane={type:'PlaneRenderer',coverage:'camera',color:{r:.2,g:.8,b:.4,a:.5}};
  const fixture={schemaVersion:1,assets:{},root:{id:'root',children:[camera,{id:'wipe',components:[plane,{...structuredClone(authored),target:null}]}]}};
  const bad=structuredClone(fixture);bad.root.children[1].components[1].pinwheel.profiles[0].fronts=[];
  assert.throws(()=>new Scene(bad,'http://localhost/scene.json'),/four fronts/);
  const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['babylon',chromium,'babylon'],['firefox',firefox,'dom']]){
    const executablePath=type===chromium?[chromium.executablePath()].find(fs.existsSync):undefined;
    const browser=await type.launch({headless:true,executablePath});
    try{
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
      if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden in DOM');};});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
      let baseline;
      for(const n of [1706,1707,1709,1710,1713,1715,1718,1719,1721,1726,1713]){
        await page.evaluate(async n=>{const {Frame}=await import('/runtime/player.js');await scenePlayer.seekFrame(Frame.from(n));await scenePlayer.whenIdle();},n);
        const shot=await page.screenshot({path:path.join(output,`${name}_${n}.png`)});
        if(n===1713){if(baseline)assert(compare(baseline,shot).mae<.001,'Reverse seek retains the exact frame');else baseline=shot;}
        if(n>=1721){const im=png(shot);assert(im.pixels.every((v,i)=>i%im.channels===3||v===0),'Completed scene is black');}
      }
      await page.evaluate(async fixture=>{await scenePlayer.loadScene(fixture);await scenePlayer.whenIdle();},fixture);
      let cells=0;
      for(const n of frames){
        await page.evaluate(async progress=>{await scenePlayer.setComponent('wipe','Transition',{progress});await scenePlayer.whenIdle();},at(n));
        const shot=await page.screenshot();if(name==='dom')evidence.set(n,shot);else assert(compare(shot,evidence.get(n)).mae<1,'Transition masks agree across renderers');cells++;
      }
      const progress=at(1715);
      for(const viewport of [{width:641,height:359},{width:390,height:844},{width:1600,height:360}]){
        await page.setViewportSize(viewport);await page.waitForFunction(v=>scenePlayer.view.width===v.width&&scenePlayer.view.height===v.height,viewport);
        for(const p of [progress,1]){
          const view=await page.evaluate(async progress=>{await scenePlayer.setComponent('wipe','Transition',{progress});await scenePlayer.whenIdle();return scenePlayer.view;},p);
          checkJoins(await page.screenshot({path:path.join(output,`${name}_${viewport.width}_${p===1?'complete':'extended'}.png`)}),view,p===1);
        }
      }
      if(renderer==='dom'){
        await page.evaluate(progress=>scenePlayer.setComponent('wipe','Transition',{progress}),progress);
        const changes=await page.evaluate(async progress=>{
          const original=document.querySelector('.transition-grid path');let writes=0;
          const observer=new MutationObserver(r=>writes+=r.length);observer.observe(scenePlayer.viewport,{attributes:true,childList:true,subtree:true});
          await scenePlayer.setComponent('wipe','Transition',{progress:progress+.001});await scenePlayer.whenIdle();writes+=observer.takeRecords().length;observer.disconnect();
          return {writes,retained:original===document.querySelector('.transition-grid path')};
        },progress);assert.deepEqual(changes,{writes:0,retained:true},'A held phase reuses the same path with no DOM writes');
      }
      const targeted=structuredClone(fixture);targeted.root.children[1].components=[{...structuredClone(authored),target:{entity:'incoming'},progress}];
      targeted.root.children.push({id:'incoming',children:[{id:'incoming-plane',components:[plane]}]});
      await page.setViewportSize({width:640,height:360});await page.waitForFunction(()=>scenePlayer.view.width===640&&scenePlayer.view.height===360);
      await page.evaluate(async data=>{await scenePlayer.loadScene(data);await scenePlayer.whenIdle();},targeted);
      assert(compare(await page.screenshot(),evidence.get(1715)).mae<1,'Target-subtree mask matches direct plane coverage');
      assert.deepEqual(errors,[]);console.log(`${name}: ${cells} mask phases; 20 Hz phases, reverse seek, aspect extension, opacity/joins, blackout and target-subtree masking passed.`);
    }finally{await browser.close();}
  }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
