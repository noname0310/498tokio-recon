const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright'),{makeServer}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const tile='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVR4nGP4z8DQwMDw/wAjiPjPwHgAADj3Br/k9JBGAAAAAElFTkSuQmCC';
const body='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIUlEQVR4nGNkYGBg2LJly38QDQJMyBywADIHQ8DHx6cRAFlJB6OQECckAAAAAElFTkSuQmCC';
const fixture={schemaVersion:1,referenceFrame:{width:640,height:360},assets:{
 body:{type:'Sprite',file:body,size:{x:4,y:4},pixelsPerUnit:10,pivot:{x:.5,y:.5},filter:'point'},
 tile:{type:'Sprite',file:tile,size:{x:2,y:2},pixelsPerUnit:10,pivot:{x:0,y:1},filter:'point'}},root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6,clearColor:{r:20/255,g:40/255,b:60/255,a:1}}]},
 {id:'sprite',transform:{localScale:{x:4,y:4}},components:[{type:'SpriteRenderer',asset:'body',brightness:0},{type:'SecondaryTexture',asset:'tile',worldSize:{x:.025,y:.025},origin:{x:-.2,y:.2},opacity:1}]}
]}};
const pixel=(im,x,y)=>[...im.pixels.subarray((y*im.width+x)*im.channels,(y*im.width+x)*im.channels+3)];
function near(actual,expected,label){assert(actual.every((v,i)=>Math.abs(v-expected[i])<=2),`${label}: ${actual} vs ${expected}`);}
async function main(){
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,images={};
 try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true});try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden');};});
   await page.goto(`${base}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
   await page.evaluate(async d=>{await scenePlayer.loadScene(d);await scenePlayer.whenIdle();},fixture);
   const idle=()=>page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});await idle();const first=await shot(),im=png(first);images[name]=first;
   near(pixel(im,252,112),[20,40,60],`${name}: transparent sprite corners stay transparent`);
   near(pixel(im,302,162),[128,0,0],`${name}: fine red tile survives black source grading`);
   near(pixel(im,307,162),[0,0,192],`${name}: adjacent blue tile remains sharp`);
   near(pixel(im,382,242),[74,20,30],`${name}: semitransparent source alpha is preserved`);
   const sourceURLs=await page.evaluate(()=>scenePlayer.resources.urls.size);
   if(renderer==='dom')await page.evaluate(()=>{window.secondaryTestSurface=document.querySelector('[data-entity="sprite"][data-component="SpriteRenderer"]');});
   await page.evaluate(()=>scenePlayer.setComponent('sprite','SecondaryTexture',{origin:{x:-.1875,y:.2}}));await idle();near(pixel(png(await shot()),302,162),[0,0,192],`${name}: live UV offset`);
   await page.evaluate(()=>scenePlayer.setComponent('sprite','SecondaryTexture',{opacity:0}));await idle();near(pixel(png(await shot()),302,162),[0,0,0],`${name}: zero opacity restores graded art`);
   await page.evaluate(()=>scenePlayer.setComponent('sprite','SecondaryTexture',{opacity:1,origin:{x:-.2,y:.2}}));await idle();assert(compare(first,await shot()).mae<.01,`${name}: repeated edits restore the initial image`);
   assert.equal(await page.evaluate(()=>scenePlayer.resources.urls.size),sourceURLs,'UV and opacity edits reuse prepared source images');
   if(renderer==='dom'){assert.equal(await page.locator('canvas').count(),0);assert(await page.evaluate(()=>!!window.secondaryTestSurface&&window.secondaryTestSurface===document.querySelector('[data-entity="sprite"][data-component="SpriteRenderer"]')),'The same render surface survives live edits');}
   assert.deepEqual(errors,[]);console.log(`${name}: secondary texture sub-texel repeat, live mapping, grading order and alpha passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
 assert(compare(images.dom,images.babylon).mae<.1,'Secondary texture backend parity');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
