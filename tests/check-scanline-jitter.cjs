const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const fixture={schemaVersion:1,timeline:{duration:10,frameRate:30},root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6,clearColor:{r:.12,g:.12,b:.12,a:1}},{type:'ScanlineJitter',seed:4983708,frequency:30,amplitudeWorld:.2,lineHeightWorld:.01},{type:'GaussianBlur',enabled:false,sigmaWorld:{x:0,y:0}}]},
 {id:'background',components:[{type:'PlaneRenderer',coverage:'camera',color:{r:.12,g:.12,b:.12,a:1}}]},
 ...[-1.5,0,1.5].map((x,i)=>({id:`bar${i}`,transform:{localPosition:{x,z:-1}},components:[{type:'PlaneRenderer',size:{x:.4,y:2.8},color:{r:1,g:1,b:1,a:1}}]})),
 {id:'horizontal',transform:{localPosition:{y:1.1,z:-2}},components:[{type:'PlaneRenderer',coverage:'camera',size:{x:6.4,y:.04},clipBounds:{left:null,right:null,bottom:-.02,top:.02},color:{r:1,g:.2,b:0,a:1}}]}
]}};
function rowError(a,b,y,x0,x1){const x=png(a),z=png(b);let sum=0;for(let c=x0;c<x1;c++)for(let k=0;k<3;k++)sum+=Math.abs(x.pixels[(y*x.width+c)*x.channels+k]-z.pixels[(y*z.width+c)*z.channels+k]);return sum/((x1-x0)*3);}
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
 for(const mutate of [c=>c.seed=-1,c=>c.seed=.5,c=>c.frequency=0,c=>c.lineHeightWorld=0,c=>c.amplitudeWorld=-1,c=>c.start={frame:.5,rate:{numerator:30,denominator:1}}]){
  const d=structuredClone(fixture);mutate(d.root.children[0].components[1]);assert.throws(()=>new Scene(d,'http://localhost/scene.json'));
 }
 const missing=structuredClone(fixture);missing.root.children[1].components.push(missing.root.children[0].components.splice(1,1)[0]);assert.throws(()=>new Scene(missing,'http://localhost/scene.json'));
 const data=JSON.parse(fs.readFileSync(path.join(root,'assets/final_animation.scene.json'))),scene=new Scene(data,'http://localhost/assets/final_animation.scene.json');
 for(const n of [3707,3708,3710.5,3716,3717,3940,3708]){
  scene.setFrameTime(Time.fromDecimal(n),frameRate(30));scene.updateWorld();const c=scene.requireComponent('helmet-flat-camera','ScanlineJitter');
  assert.equal(c.enabled,n>=3708&&n<3717);if(c.enabled)assert(Math.abs(c.amplitudeWorld-.217*(3717-n)/9)<1e-7);
 }
 const bindings=data.animation.sequences['flashback-meeting'].bindings.filter(b=>b.property.component==='ScanlineJitter');assert.equal(bindings.length,2);for(const b of bindings)assert.equal(data.animation.tracks[b.track].frameNumber.length,2);
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,edge=new Map();
 try{for(const [label,type,renderer]of [['Edge DOM',chromium,'dom'],['Firefox DOM',firefox,'dom'],['Babylon',chromium,'babylon']]){
  const browser=await type.launch(type===chromium?{headless:true,channel:'msedge'}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=3710`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const settle=()=>page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const seek=async n=>{await page.evaluate(async n=>{const {Time,frameRate}=await import(new URL('runtime/player.js',document.baseURI).href);await scenePlayer.seekFrame(Time.fromDecimal(n),frameRate(30));},n);await settle();};
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   await settle();const real=await shot();
   for(const n of [3717,3940,3707,3710])await seek(n);
   assert(compare(real,await shot()).mae<.002,`${label}: real-scene rewind restores effect order and noise`);
   await page.evaluate(f=>scenePlayer.loadScene(f),fixture);await settle();
   const results=[];
   for(const n of [0,.5,1,7]){await seek(n);const im=await shot();results.push(im);if(label==='Edge DOM')edge.set(n,im);else assert(compare(im,edge.get(n)).mae<1.8,`${label}: shared row pattern at ${n}`);}
   assert(compare(results[0],results[2]).mae>1,'A scene without an animation sequence still updates noise time');
   assert(compare(results[0],results[1]).mae>.5,'Subframes interpolate the noise');
   await seek(0);assert(compare(results[0],await shot()).mae<.002,'Noise is seek-independent');
   for(const [x,y]of [[.01,.01],[0,.01],[.01,0],[.01,.01],[0,0]]){
    await page.evaluate(v=>scenePlayer.setComponent('camera','GaussianBlur',{enabled:true,sigmaWorld:v}),{x,y});await settle();
    const key=`blur:${x}:${y}`,im=await shot();if(label==='Edge DOM')edge.set(key,im);else assert(compare(im,edge.get(key)).mae<2,`${label}: blur/jitter order ${key}`);
   }
   assert(compare(results[0],await shot()).mae<.002,'Removing blur preserves the jitter pass');
   // A wide horizontal stripe must retain its Y coordinates, even with a
   // nonzero map and fractional X offsets. Borders may not expose transparency.
   await page.evaluate(()=>scenePlayer.setComponent('camera','ScanlineJitter',{amplitudeWorld:0}));await settle();const off=await shot();
   for(const y of [67,68,69,70,71,72,73])assert(rowError(results[0],off,y,220,270)<1,'Zero vertical displacement');
   if(renderer==='dom'){
    assert.equal(await page.locator('.scene-world').evaluate(e=>e.style.filter),'none');assert.equal(await page.locator('canvas').count(),0);
    await page.evaluate(()=>scenePlayer.setComponent('camera','ScanlineJitter',{amplitudeWorld:.2}));await settle();
    const retained=await page.evaluate(async()=>{
      const maps=[...document.querySelectorAll('[id^="camera-jitter-"] feImage')],hrefs=maps.map(n=>n.getAttribute('href')),observer=new MutationObserver(()=>{});
      observer.observe(scenePlayer.viewport,{subtree:true,childList:true});
      for(const n of [1,2,3])await scenePlayer.seekFrame(n,{numerator:30,denominator:1});
      const changes=observer.takeRecords();observer.disconnect();
      return maps.every((n,i)=>n.isConnected&&n.getAttribute('href')===hrefs[i])&&!changes.some(c=>[...c.addedNodes,...c.removedNodes].some(n=>n.nodeType===1));
    });assert(retained,'Animated filters reuse nodes and decoded images');
   }else{await page.evaluate(()=>scenePlayer.setComponent('camera','ScanlineJitter',{amplitudeWorld:.2}));await settle();}
   for(const size of [{width:390,height:844},{width:1440,height:400}]){
    await page.setViewportSize(size);await settle();await seek(1);const im=png(await shot());
    for(const [x,y]of [[0,0],[im.width-1,0],[0,im.height-1],[im.width-1,im.height-1]])for(let k=0;k<3;k++)assert(Math.abs(im.pixels[(y*im.width+x)*im.channels+k]-31)<=1,`${label}: clamped viewport corners`);
   }
   await page.evaluate(()=>scenePlayer.setReferenceAspect(true));await settle();const box=await page.locator('#viewport').boundingBox();assert(Math.abs(box.width/box.height-16/9)<.001);
   assert.deepEqual(errors,[]);console.log(`${label}: shared noise, subframes, rewind, zero-Y displacement, clamp, reuse and adaptive aspect passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
