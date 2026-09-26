const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright'),{makeServer}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const tile='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAG0lEQVR4nGNMqehhYGBgaGBgYKhnArFgAIUDAFFhAm05i+D2AAAAAElFTkSuQmCC';
const ramp={type:'ColorGradient',start:{x:0,y:.15},end:{x:0,y:-.15},startColor:{r:1,g:0,b:0,a:.25},endColor:{r:0,g:0,b:1,a:.75}};
const fixture={schemaVersion:1,assets:{tile:{type:'Sprite',file:tile,size:{x:3,y:3},pixelsPerUnit:10,pivot:{x:0,y:1},filter:'point'}},root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6,clearColor:{r:20/255,g:40/255,b:60/255,a:1}}]},
 {id:'tile',components:[{type:'TiledSpriteRenderer',asset:'tile',origin:{x:-.15,y:.15},wrap:{x:'repeat',y:'transparent'}},ramp]}
]}};
const pixel=(p,x,y)=>[...p.pixels.subarray((y*p.width+x)*p.channels,(y*p.width+x)*p.channels+3)];
const near=(a,b,label)=>assert(a.every((v,i)=>Math.abs(v-b[i])<=3),`${label}: ${a} vs ${b}`);
async function main(){
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,images={};
 try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch();try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden');};});
   await page.goto(`${base}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
   await page.evaluate(async d=>{await scenePlayer.loadScene(d);await scenePlayer.whenIdle();},fixture);
   const idle=()=>page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});await idle();images[name]=await shot();const p=png(images[name]);
   for(const y of [167,172,182,192])for(const [x,a]of [[309,0],[319,128/255],[329,1],[359,1]]){
    const t=(y+.5-165)/30,opacity=.25*(1-t)+.75*t;
    const rgb=[100,120,140].map((v,i)=>v*(1-opacity)+(i===0?1-t:i===2?t:0)*opacity*255);
    near(pixel(p,x,y),rgb.map((v,i)=>v*a+[20,40,60][i]*(1-a)),`${name} preserved alpha and repeated local ramp at ${x},${y}`);
   }
   near(pixel(p,329,162),[20,40,60],`${name} transparent wrap`);
   if(renderer==='dom')await page.evaluate(()=>{window.gradientTestSurface=document.querySelector('[data-entity="tile"]');});
   await page.evaluate(()=>scenePlayer.setComponent('tile','ColorGradient',{enabled:false}));await idle();near(pixel(png(await shot()),329,172),[100,120,140],`${name} disabled ramp`);
   await page.evaluate(()=>scenePlayer.setComponent('tile','ColorGradient',{enabled:true,endColor:{r:0,g:1,b:0,a:1}}));await idle();assert(compare(images[name],await shot()).mae>.1,'Live gradient parameters alter the image');
   await page.evaluate(c=>scenePlayer.setComponent('tile','ColorGradient',c),ramp);await idle();assert(compare(images[name],await shot()).mae<.01,'Gradient edits restore the same image');
   if(renderer==='dom')assert(await page.evaluate(()=>window.gradientTestSurface===document.querySelector('[data-entity="tile"]')),'Retain the same surface across edits');
   assert.deepEqual(errors,[]);console.log(`${name}: color gradient, partial alpha, repetition and live edits passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
 assert(compare(images.dom,images.babylon).mae<.1,'Color gradient backend parity');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
