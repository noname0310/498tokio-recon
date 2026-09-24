const assert=require('node:assert/strict'),{chromium,firefox}=require('playwright');
const {makeServer}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const dots='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB8AAAABCAYAAAAmcnXSAAAAEklEQVR4nGP4////f4YBACB7AfKYB/nePN/PAAAAAElFTkSuQmCC';
function fixture(){return {schemaVersion:1,assets:{dots:{type:'Sprite',file:dots,size:{x:31,y:1},pixelsPerUnit:15}},root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{z:-4}},components:[{type:'Camera',projection:'perspective',verticalFovDegrees:45,referenceVerticalSize:3.6,near:.1,far:20},{type:'DepthOfField',enabled:false,focusDistance:4+Math.sqrt(3)/2,apertureSigma:.04}]},
 {id:'dots',transform:{localRotation:{y:60}},components:[{type:'SpriteRenderer',asset:'dots'}]}
]}};}
function variance(bytes,center){const im=png(bytes),rows=[];let sum=0,cx=0,cy=0;for(let y=Math.floor(center.y-25);y<=center.y+25;y++)for(let x=Math.floor(center.x-25);x<=center.x+25;x++){const w=im.pixels[(y*im.width+x)*im.channels];sum+=w;cx+=x*w;cy+=y*w;rows.push([x,y,w]);}cx/=sum;cy/=sum;return [rows.reduce((v,[x,y,w])=>v+(x-cx)**2*w,0)/sum,rows.reduce((v,[x,y,w])=>v+(y-cy)**2*w,0)/sum];}
async function main(){const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer]of [['DOM',chromium,'dom'],['Firefox DOM',firefox,'dom'],['Babylon',chromium,'babylon']]){
  const browser=await type.launch(type===chromium?{headless:true,channel:'msedge'}:{headless:true});try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());await page.evaluate(data=>scenePlayer.loadScene(data),fixture());
   const settle=()=>page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});await settle();
   const centers=await page.evaluate(()=>{const s=scenePlayer.scene,v=scenePlayer.view,w=s.world.get('dots');return [-1,1].map(x=>{const q=s.projectCameraPoint({x:w[0]*x,y:0,z:4+w[2]*x});return {x:v.width/2+q.x*v.pixelsPerUnit,y:v.height/2,depth:q.z};});});
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'}),sharp=await shot(),baseline=centers.map(p=>variance(sharp,p));
   await page.evaluate(()=>scenePlayer.setComponent('camera','DepthOfField',{enabled:true}));await settle();const blurred=await shot(),actual=centers.map(p=>variance(blurred,p));
   const delta=actual.map((v,i)=>v.map((x,j)=>x-baseline[i][j]));
   assert(delta[1][1]>2,`${name}: the near end of a single tilted sprite must defocus: ${JSON.stringify(delta)}`);assert(Math.abs(delta[0][1])<1,`${name}: its far end lies on the focus plane: ${JSON.stringify(delta)}`);
   if(renderer==='dom'){
    assert.equal(await page.locator('canvas').count(),0);
    const mutations=await page.evaluate(async()=>{let n=0;const o=new MutationObserver(rows=>n+=rows.length);o.observe(scenePlayer.renderer.world,{attributes:true,childList:true,subtree:true});await scenePlayer.update();await Promise.resolve();o.disconnect();return n;});assert.equal(mutations,0,'Paused focus retains layers, gradients and filters without DOM writes');
   }
   await page.evaluate(()=>scenePlayer.setComponent('camera','DepthOfField',{maxSigmaWorld:.005}));await settle();const capped=variance(await shot(),centers[1]);assert(Number.isFinite(capped[1])&&capped[1]-baseline[1][1]<1.5,`${name}: capped blur keeps the out-of-focus sprite visible`);
   await page.evaluate(()=>scenePlayer.setComponent('camera','DepthOfField',{enabled:false}));await settle();assert(compare(sharp,await shot()).mae<.001,`${name}: disabling focus restores the original sprite`);
   if(renderer==='babylon'){
    // A depth-writing cutout must not reject its own color when blur expands
    // the quad. The close orbit and wide depth range expose sub-ULP mismatch.
    const hull='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHklEQVR4nGMMCAj4z4AEmEDEhg0bGFEEkFWBBZABABAkBfcHTWg9AAAAAElFTkSuQmCC';
    await page.evaluate(data=>scenePlayer.loadScene(data),{schemaVersion:1,assets:{hull:{type:'Sprite',file:hull,size:{x:4,y:4},pixelsPerUnit:4}},root:{id:'root',children:[
     {id:'camera',transform:{localPosition:{z:-.9}},components:[{type:'Camera',projection:'perspective',verticalFovDegrees:63,referenceVerticalSize:3.6,near:.001,far:300},{type:'DepthOfField',focusDistance:1.25,apertureSigma:.012}]},
     {id:'hull',components:[{type:'SpriteRenderer',asset:'hull',depthWrite:true},{type:'SpriteMotionBlur',enabled:false,translationWorld:{x:.04,y:.02}}]}
    ]}});
    for(const motion of [false,true]){
     await page.evaluate(async motion=>{await scenePlayer.setComponent('camera','DepthOfField',{enabled:!motion});await scenePlayer.setComponent('hull','SpriteMotionBlur',{enabled:motion});},motion);
     for(const [x,y]of [[16,37],[-12,-43],[4,8]]){
      await page.evaluate(rotation=>scenePlayer.setTransform('hull',{localRotation:rotation}),{x,y});
      await page.evaluate(()=>scenePlayer.setComponent('hull','SpriteRenderer',{depthWrite:true}));await settle();const depth=await shot();
      await page.evaluate(()=>scenePlayer.setComponent('hull','SpriteRenderer',{depthWrite:false}));await settle();const plain=await shot(),difference=compare(depth,plain);
      assert(difference.max<=1&&difference.mae<.001,`${name}: expanded ${motion?'motion':'focus'} quad must not self-occlude at ${x},${y}: ${JSON.stringify(difference)}`);
     }
    }
   }
   assert.deepEqual(errors,[]);console.log(`${name}: per-plane focus, transparent edges, bypass and retained layers passed; variance delta ${JSON.stringify(delta)}`);
  }finally{await browser.close();}
 }}finally{server.close();}}
main().catch(e=>{console.error(e);process.exitCode=1});
