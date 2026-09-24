const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file));
// Independent evaluation of the continuous field, away from antialiased edges.
function checkField(bytes,view,c,label){
 const im=png(bytes),g=c.radialGrid,units=view.pixelsPerUnit*view.dpr;let checked=0,bad=0,first;
 for(let y=3;y<im.height-3;y++)for(let x=3;x<im.width-3;x++){
  const px=(x+.5)/units-view.worldWidth/2,py=view.worldHeight/2-(y+.5)/units;
  const cx=g.origin.x+(Math.floor((px-g.origin.x)/g.cellSize.x)+.5)*g.cellSize.x,cy=g.origin.y+(Math.floor((py-g.origin.y)/g.cellSize.y)+.5)*g.cellSize.y;
  const field=c.progress-g.inset+g.curvature*((px-g.center.x)**2+(py-g.center.y)**2)-Math.max(2*Math.abs(px-cx)/g.cellSize.x,2*Math.abs(py-cy)/g.cellSize.y);
  const margin=2.5*(2/Math.min(g.cellSize.x,g.cellSize.y)+2*g.curvature*Math.hypot(px-g.center.x,py-g.center.y))/units;
  if(c.progress>0&&c.progress<1&&Math.abs(field)<margin)continue;
  const covered=c.progress>=1||(c.progress>0&&field>=0);checked++;
  for(const [ch,color] of [25.5,102,51].entries())if(Math.abs(im.pixels[(y*im.width+x)*im.channels+ch]-(covered?color:0))>2){bad++;first??={x,y,field,covered};}
 }
 assert(checked>20000);assert.equal(bad,0,`${label}: field/opacity/seam mismatch ${JSON.stringify(first)}`);
}
async function main(){
 const {Scene,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),scene=new Scene(data,pathToFileURL(file).href),at=n=>{scene.setFrameTime(Time.fromDecimal(n),frameRate(30));scene.updateWorld();};
 for(const n of [3369.99,3370,3387,3423.99,3424,3430,3431]){
  at(n);assert.equal(scene.nodes.has('paper-return-flight-root'),n>=3370&&n<3424);assert.equal(scene.nodes.has('paper-return-landscape-root'),n>=3424&&n<3431);
 }
 at(3400);assert(Math.abs(scene.world.get('paper-return-large-plane')[12]+1.3146553)<.001);assert.equal(scene.transformAt('paper-return-large-plane').localScale.x,5);
 const observations=[[3424,.9572377,.3466243],[3425,.6780173,.4211123],[3426,.2775335,.4039268],[3427,.0557734,.2974626],[3428,.0150258,.2033945]];
 for(const [n,p,b]of observations){at(n);const c=scene.requireComponent('paper-return-reveal','Transition');assert(Math.abs(c.progress-c.radialGrid.inset-p)<.004);assert(Math.abs(c.radialGrid.curvature*12.96-b)<.009);}
 at(3429);const last=scene.requireComponent('paper-return-reveal','Transition');assert(last.progress<last.radialGrid.inset,'Central cells disappear before the outer dots');assert(Math.abs(last.radialGrid.curvature*12.96-.12934938)<.00001);
 at(3430);assert.equal(scene.requireComponent('paper-return-reveal','Transition').progress,0);
 for(const [key,track]of Object.entries(data.animation.tracks))if(key.startsWith('paper-return-'))assert.equal(track.frameNumber.length,key.includes('reveal')?3:2,`${key} remains a sparse fitted curve`);
 at(3095);assert.equal(scene.requireComponent('return-rear-ship','SpriteRenderer').asset,'ship_rear_red');at(900);assert.equal(scene.requireComponent('forward-ship','SpriteRenderer').asset,'ship_rear');
 const blue=png(fs.readFileSync(path.join(root,'assets',data.assets.ship_rear.file))),red=png(fs.readFileSync(path.join(root,'assets',data.assets.ship_rear_red.file)));let changed=0;
 assert.equal(blue.width,red.width);assert.equal(blue.height,red.height);
 for(let i=0;i<blue.width*blue.height;i++){const p=i*4;assert.equal(blue.pixels[p+3],red.pixels[p+3]);if(!blue.pixels.subarray(p,p+3).equals(red.pixels.subarray(p,p+3))){changed++;assert(i/blue.width<12);assert(red.pixels[p]>2*red.pixels[p+2]);}}
 assert.equal(changed,29,'Only the registered canopy rim changes; preserve the user-edited hull and alpha');
 at(3426);const authored=structuredClone(scene.requireComponent('paper-return-reveal','Transition'));
 const fixture={schemaVersion:1,root:{id:'root',children:[{id:'camera',transform:{localPosition:{x:0,y:0,z:-10}},components:[{type:'Camera'}]},{id:'wipe',components:[{type:'PlaneRenderer',coverage:'camera',color:{r:.2,g:.8,b:.4,a:.5}},authored]}]}};
 const invalid=structuredClone(fixture);invalid.root.children[1].components[1].radialGrid.curvature=10;assert.throws(()=>new Scene(invalid,'http://localhost/scene.json'),/curvature/);
 console.log('Paper return: sparse fits, observed deformation, chapter lifetimes and isolated red canopy variant passed.');
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,shots=new Map();
 try{for(const [label,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch(type===chromium?{headless:true,channel:'msedge'}:{headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&frame=3400`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const seek=n=>page.evaluate(async n=>{await scenePlayer.seekFrame(n,{numerator:30,denominator:1});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},n),shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   for(const n of [3095,3387,3400,3410,3424,3425,3426,3427,3428,3430]){await seek(n);shots.set(`${label}/${n}`,await shot());}
   await seek(3426);const first=await shot();await seek(3431);await seek(3387);await seek(3426);assert(compare(first,await shot()).mae<.002,'Reverse seeks reproduce the reveal');
   await page.evaluate(f=>scenePlayer.loadScene(f),fixture);await page.evaluate(()=>scenePlayer.whenIdle());
   if(renderer==='dom')await page.evaluate(()=>{window.retained=document.querySelector('.transition-grid path');});
   for(const c of [{width:640,height:360,p:.278,k:.0312},{width:641,height:359,p:.679,k:.0325},{width:375,height:812,p:.0558,k:.023},{width:1280,height:360,p:.956,k:.027},{width:640,height:360,p:.5,k:0},{width:375,height:812,p:1,k:.03},{width:1280,height:360,p:0,k:0}]){
    await page.setViewportSize({width:c.width,height:c.height});await page.waitForFunction(c=>scenePlayer.view.width===c.width&&scenePlayer.view.height===c.height,c);
    const state=await page.evaluate(async c=>{await scenePlayer.setComponent('wipe','Transition',{progress:c.p,radialGrid:{curvature:c.k}});await scenePlayer.whenIdle();return {view:scenePlayer.view,c:scenePlayer.scene.requireComponent('wipe','Transition')};},c);
    checkField(await shot(),state.view,state.c,`${label}/${c.width}/${c.p}`);
   }
   if(renderer==='dom'){
    await page.evaluate(()=>scenePlayer.setComponent('wipe','Transition',{progress:.4}));assert(await page.evaluate(()=>window.retained===document.querySelector('.transition-grid path')));assert.equal(await page.locator('canvas').count(),0);
    const writes=await page.evaluate(async()=>{const observer=new MutationObserver(()=>{});observer.observe(scenePlayer.viewport,{attributes:true,childList:true,subtree:true});await scenePlayer.update();const n=observer.takeRecords().length;observer.disconnect();return n;});assert.equal(writes,0);
   }
   assert.deepEqual(errors,[]);console.log(`${label}: radial field, joined edges, half opacity, aspect expansion and retained geometry passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
 // The existing 2.5x checkerboard tile has browser-specific point sampling.
 // Bound reveal differences by that unobscured background baseline; the
 // uniform-plane tests above check the new mask independently of artwork.
 for(const label of ['firefox-dom','babylon']){
  const baseline=compare(shots.get('dom/3430'),shots.get(`${label}/3430`)).mae;assert(baseline<7,`${label}: reused landscape baseline ${baseline}`);
  for(const n of [3387,3400,3410,3424,3425,3426,3427,3428]){const diff=compare(shots.get(`dom/${n}`),shots.get(`${label}/${n}`));assert(diff.mae<(n<3424?1:baseline+.6),`${label}/${n}: ${JSON.stringify(diff)}`);}
 }
 console.log('Paper-return renderer parity passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
