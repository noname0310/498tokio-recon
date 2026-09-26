const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright'),{makeServer}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const rgb=(r,g,b,a=1)=>({r,g,b,a});
const fixture={schemaVersion:1,root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
 {id:'outgoing',transform:{localPosition:{z:2}},components:[{type:'PlaneRenderer',coverage:'camera',color:rgb(0,.1,.8)}]},
 {id:'incoming',children:[
  {id:'red',transform:{localPosition:{z:.8}},components:[{type:'PlaneRenderer',size:{x:5,y:3.2},color:rgb(1,.1,0)}]},
  {id:'green',transform:{localPosition:{x:.6,y:.2,z:.2}},components:[{type:'PlaneRenderer',size:{x:2,y:2},color:rgb(0,1,0)}]},
  {id:'translucent',transform:{localPosition:{x:2.2,y:1.2,z:.1}},components:[{type:'PlaneRenderer',size:{x:.5,y:.5},color:rgb(1,1,1,.4)}]}
 ]},
 {id:'fade',transform:{localPosition:{z:-1}},components:[{type:'Transition',kind:'fade',progress:.5,target:{entity:'incoming'}},{type:'GaussianBlur',enabled:false,sigmaWorld:{x:.1,y:0}}]}
]}};
async function main(){
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer]of [['chromium',chromium,'dom'],['firefox',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden');};});
   await page.goto(`${base}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
   await page.evaluate(f=>scenePlayer.loadScene(f),fixture);
   const settle=()=>page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   for(const size of [{width:640,height:360},{width:390,height:844},{width:1300,height:400}]){
    await page.setViewportSize(size);await settle();let first;
    for(const progress of [.5,.25,.75,1,0,.5]){
     await page.evaluate(p=>scenePlayer.setComponent('fade','Transition',{progress:p}),progress);await settle();
     const image=await shot(),im=png(image),view=await page.evaluate(()=>scenePlayer.view);
     const check=(x,y,expected)=>{const px=Math.floor((x+view.worldWidth/2)*view.pixelsPerUnit),py=Math.floor((view.worldHeight/2-y)*view.pixelsPerUnit),at=(py*im.width+px)*im.channels;for(let c=0;c<3;c++)assert(Math.abs(im.pixels[at+c]-expected[c]*255)<3,`${name} p=${progress}, (${x},${y}), channel ${c}: ${im.pixels[at+c]} vs ${expected[c]*255}`);};
     check(0,.2,[0,.1*(1-progress)+progress,.8*(1-progress)]);
     check(-1.8,0,[progress,.1,.8*(1-progress)]);
     check(-3,0,[0,.1,.8]);
     if(progress===.5){if(first)assert(compare(first,image).mae<.001,'Rewind restores the composed fade');else first=image;}
    }
   }
   await page.evaluate(()=>scenePlayer.setComponent('red','PlaneRenderer',{enabled:false}));await settle();
   const im=png(await shot()),view=await page.evaluate(()=>scenePlayer.view),at=(Math.floor((view.worldHeight/2-1.2)*view.pixelsPerUnit)*im.width+Math.floor((2.2+view.worldWidth/2)*view.pixelsPerUnit))*im.channels;
   for(const [c,value]of [.2,.28,.84].entries())assert(Math.abs(im.pixels[at+c]-value*255)<3,`${name}: partial source alpha composes only once`);
   // A sprite-to-sprite crossfade sums premultiplied RGBA in isolation.
   // Complementary opacities keep the overlapping region opaque, including
   // black ink; the unrelated blue background must not leak into that region.
   await page.setViewportSize({width:640,height:360});
   await page.evaluate(async()=>{
    await scenePlayer.setComponent('red','PlaneRenderer',{enabled:true,color:{r:1,g:.1,b:0,a:.25}});
    await scenePlayer.setComponent('green','PlaneRenderer',{color:{r:0,g:1,b:0,a:.75}});
    await scenePlayer.setComponent('translucent','PlaneRenderer',{enabled:false});
    await scenePlayer.setComponent('fade','Transition',{composition:'plus-lighter',progress:1});
   });await settle();
   const sample=async(x,y)=>{const image=png(await shot()),i=(y*image.width+x)*image.channels;return Array.from(image.pixels.subarray(i,i+3));};
   const checkRGB=(actual,expected,label)=>expected.forEach((v,c)=>assert(Math.abs(actual[c]-v*255)<3,`${name}: ${label} ${actual}`));
   checkRGB(await sample(320,160),[.25,.775,0],'crossfade has no background leak');
   checkRGB(await sample(140,180),[.25,.1,.6],'single-sprite edge retains partial alpha');
   await page.evaluate(()=>scenePlayer.setComponent('fade','Transition',{progress:.5}));await settle();
   checkRGB(await sample(320,160),[.125,.4375,.4],'group opacity follows the RGBA sum');
   await page.evaluate(()=>scenePlayer.setComponent('fade','Transition',{composition:'source-over'}));await settle();
   checkRGB(await sample(320,160),[.03125,.4375,.475],'ordinary blend state restored after additive capture');
   await page.evaluate(async()=>{
    await scenePlayer.setComponent('red','PlaneRenderer',{enabled:false});await scenePlayer.setComponent('green','PlaneRenderer',{color:{r:0,g:1,b:0,a:1}});
    await scenePlayer.setComponent('fade','Transition',{progress:1});await scenePlayer.setComponent('fade','GaussianBlur',{enabled:true});
   });await settle();
   const edge=await sample(280,160);assert(edge[1]>125&&edge[1]<160&&edge[2]>85&&edge[2]<110,`${name}: subtree Gaussian edge ${edge}`);
   checkRGB(await sample(380,160),[0,1,0],'opaque subtree interior stays opaque');
   checkRGB(await sample(280,55),[0,.1,.8],'horizontal blur does not spread vertically');
   await page.evaluate(()=>scenePlayer.setComponent('fade','GaussianBlur',{enabled:false}));await settle();checkRGB(await sample(280,160),[0,1,0],'sharp rendering restores after blur');
   assert.deepEqual(errors,[]);console.log(`${name}: subtree opacity, overlapping layers, partial alpha, aspect changes and rewind passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
