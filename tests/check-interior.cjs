const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const output=path.join(root,'test-results/interior_motion/rendered');fs.mkdirSync(output,{recursive:true});
async function settled(page){await page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
async function main(){
  const {Scene,Frame,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
  const file='assets/final_animation.scene.json',data=read(file),scene=new Scene(data,pathToFileURL(path.join(root,file)).href);
  const at=n=>{scene.setFrameTime(Time.fromFrame(Frame.from(n)),frameRate(30));scene.updateWorld();};
  const feet=new Map([[1794,2],[1795,3],[1796,0],[1797,2],[1798,3],[1799,0],[1800,2],[1801,3],[1802,0],[1803,2],[1804,3],[1805,0],[1806,2],[1807,3],[1808,0],[1809,2],[1810,3],[1811,0],[1812,2],[1813,3],[1814,0],[1815,2],[1816,3],[1817,0],[1818,2],[1819,3]]);
  const chestPoses=[{"frame":1940,"poses":[6,6,6,6],"facings":[1,1,1,1]},{"frame":1955,"poses":[7,6,6,6],"facings":[1,1,1,1]},{"frame":1969,"poses":[7,7,6,6],"facings":[1,1,1,1]},{"frame":1982,"poses":[7,7,7,6],"facings":[1,1,1,1]},{"frame":1995,"poses":[7,7,7,7],"facings":[1,1,1,1]},{"frame":2009,"poses":[8,8,8,8],"facings":[1,1,1,-1]}];
  const checkPoses=n=>{
    if(n>=1791&&n<1820)for(let i=0;i<8;i++)assert.equal(scene.spriteState(`interior-jumper-${i}`).frame,feet.get(n<1794?n+3:n),`Cropped walking feet match source at ${n}, person ${i}`);
    if(n>=1940&&n<2023){
      const expected=chestPoses.findLast(p=>p.frame<=n);
      for(let i=0;i<4;i++){
        const id=`interior-chest-person-${i}`;
        assert.equal(scene.spriteState(id).frame,expected.poses[i],`Chest reaction pose matches source at ${n}, person ${i}`);
        assert.equal(Math.sign(scene.world.get(id)[0]),expected.facings[i],`Chest reaction direction matches source at ${n}, person ${i}`);
      }
    }
  };
  for(let n=1722;n<=2100;n++){
    at(n);assert.equal(scene.cameraNode.id,n<1727?'landscape-camera':'interior-camera');
    assert.equal(scene.active.get('landscape-scene'),n<1727);assert.equal(scene.active.get('interior-scene'),n>=1727);
    if(n>=1727){
      assert.equal(scene.component('interior-camera','ViewportFrame').enabled,n<1820||n>=1837&&n<1920||n>=1940&&n<2023);
      assert.equal(scene.component('interior-camera','Vignette').enabled,n>=2097);
      for(const id of ['interior-beam-room','interior-tableau','interior-ball-room','interior-chest-room','interior-light-room'])assert.equal(typeof scene.active.get(id),'boolean');
    }
    for(const m of scene.world.values())assert(m.every(Number.isFinite),`Finite transforms at ${n}`);
    checkPoses(n);
  }
  for(const n of [2022,2009,2008,1996,1954,1819,1793,1792,1791]){at(n);checkPoses(n);}
  at(1790);assert.equal(scene.spriteState('interior-jumper-0').frame,2,'Seeking before the fast loop restores the preceding run cycle');
  at(1820);assert.equal(scene.active.get('interior-jumper-0'),false,'The cropped walking group ends at the cut');
  assert.equal(data.animation.tracks['interior-ball-x'].frameNumber.length,3);
  for(const n of [1883,1884,1893,1894,2009,2010,2017,2022]){at(n);const id=n<1940?'interior-runner-surprise-0':'interior-chest-surprise-0';assert.equal(Boolean(scene.spriteState(id).visible&&scene.active.get(id)),n%2===1,'Source surprise alternates every frame');}
  at(2100);assert.equal(scene.world.get('interior-final-person')[14],0);assert.equal(scene.world.get('interior-light-column')[14],2);
  const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const captures=[1726,1728,1732,1735,1740,1768,1797,1798,1799,1808,1825,1837,1857,1883,1898,1908,1927,1943,1955,1996,2008,2009,2011,2030,2055,2083,2097,2100];
  const rows=[];const references=new Map();
  const fixture={schemaVersion:1,assets:{},root:{id:'root',children:[
    {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
    {id:'mask',components:[{type:'PlaneRenderer',coverage:'camera',color:{r:.2,g:.8,b:.4,a:.5}},{type:'Transition',kind:'dissolve',progress:.43,dissolve:{cellSize:{x:.3,y:.3},origin:{x:-3.2,y:1.8},seed:1508}}]}
  ]}};
  try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['babylon',chromium,'babylon'],['firefox',firefox,'dom']]){
    const executablePath=type===chromium?[chromium.executablePath()].find(fs.existsSync):undefined;
    const browser=await type.launch({headless:true,executablePath});
    try{
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden in DOM renderer');};});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
      for(const n of captures){
        await page.evaluate(async n=>{const {Frame}=await import('/runtime/player.js');await scenePlayer.seekFrame(Frame.from(n));},n);await settled(page);
        const shot=await page.screenshot({path:path.join(output,`${name}_${n}.png`)});
        if(n===2097){
          if(name==='dom')references.set('light',shot);else assert(compare(references.get('light'),shot).mae<1.2,`${name}: floor gradient, glow and textured column match DOM`);
          const im=png(shot),k=(285*im.width+320)*im.channels;assert(im.pixels[k]>10,'Floor glow remains visible below the opaque sprite');
        }
        rows.push({renderer:name,frame:n});
      }
      for(const size of [{width:390,height:844},{width:1280,height:320}]){
        await page.setViewportSize(size);await page.waitForFunction(s=>scenePlayer.view.width===s.width&&scenePlayer.view.height===s.height,size);await settled(page);
        await page.screenshot({path:path.join(output,`${name}_2100_${size.width}.png`)});
      }
      if(renderer==='dom'){
        const mutations=await page.evaluate(async()=>{let count=0;const observer=new MutationObserver(records=>count+=records.length);observer.observe(document.querySelector('#viewport'),{attributes:true,childList:true,subtree:true});for(let i=0;i<5;i++)await scenePlayer.update();await Promise.resolve();observer.disconnect();return count;});
        assert.equal(mutations,0,'Paused scene reuses retained DOM surfaces without mutations');
      }
      await page.setViewportSize({width:640,height:360});await page.waitForFunction(()=>scenePlayer.view.width===640&&scenePlayer.view.height===360);await settled(page);await page.evaluate(async input=>scenePlayer.loadScene(input),fixture);await settled(page);
      const mask=await page.screenshot({path:path.join(output,`${name}_dissolve.png`)});if(name==='dom')references.set('mask',mask);else {const diff=compare(references.get('mask'),mask);console.log(name,'dissolve difference',diff);assert(diff.mae<.35,`${name}: seeded cells agree with DOM`);}
      for(const progress of [0,1,.43]){await page.evaluate(async progress=>{await scenePlayer.setComponent('mask','Transition',{progress});},progress);await settled(page);const shot=await page.screenshot();if(progress===.43)assert(compare(mask,shot).mae<.001,'Dissolve reverse seek is deterministic');else{const p=png(shot),expected=progress===0?[0,0,0]:[26,102,51];for(let y=5;y<p.height;y+=7)for(let x=5;x<p.width;x+=7){const i=(y*p.width+x)*p.channels;assert(expected.every((v,c)=>Math.abs(v-p.pixels[i+c])<=1),'Complete/empty dissolve has no seams');}}}
      await page.evaluate(async()=>{await scenePlayer.addComponent('mask',{type:'ProceduralNoise',seed:7,textureSize:{x:64,y:64},worldSize:{x:.64,y:.64},range:.5,bands:[{sigmaTexels:{x:1,y:1},variance:.02}]});});await settled(page);
      assert(compare(mask,await page.screenshot()).mae>1,'Adding procedural plane noise affects the rendered cells');
      await page.evaluate(async()=>{await scenePlayer.removeComponent('mask','ProceduralNoise');});await settled(page);assert(compare(mask,await page.screenshot()).mae<.001,'Removing plane noise restores the original cells');
      for(const size of [{width:390,height:844},{width:1280,height:320}]){
        await page.setViewportSize(size);await page.waitForFunction(s=>scenePlayer.view.width===s.width&&scenePlayer.view.height===s.height,size);await settled(page);
        const shot=await page.screenshot(),key=`mask-${size.width}`;if(name==='dom')references.set(key,shot);else assert(compare(references.get(key),shot).mae<1,'Expanded dissolve preserves the same field across renderers');
      }
      assert.deepEqual(errors,[],`${name} browser errors`);console.log(`${name}: render captures, dynamic aspect, deterministic dissolve passed.`);
    }finally{await browser.close();}
  }}finally{await new Promise(r=>server.close(r));}
  console.log('Interior: all 379 frames evaluated; poses, visibility, cameras and procedural effects passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
