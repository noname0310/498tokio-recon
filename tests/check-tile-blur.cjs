const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright'),{makeServer}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');
const white='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
const fixture={schemaVersion:1,assets:{tile:{type:'Sprite',file:white,size:{x:1,y:1},pixelsPerUnit:1,pivot:{x:0,y:1}}},root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
 {id:'tile',components:[{type:'TiledSpriteRenderer',asset:'tile',origin:{x:0,y:.5},wrap:{x:'repeat',y:'transparent'}},{type:'GaussianBlur',sigmaWorld:{x:0,y:.08}},{type:'Glow',enabled:false,sigmaWorld:.08,intensity:1},{type:'DropShadow',enabled:false,offsetWorld:{x:0,y:-.2},sigmaWorld:.08,color:{r:1,g:0,b:0,a:1},opacity:.5}]}
]}};
function cdf(x){const t=1/(1+.2316419*Math.abs(x)),p=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*(t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429)))));return x<0?p:1-p;}
async function main(){
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [label,type,renderer]of [['DOM',chromium,'dom'],['Firefox DOM',firefox,'dom'],['Babylon',chromium,'babylon']]){
  const browser=await type.launch();try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route(url=>url.pathname==='/tile-fixture.scene.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(fixture)}));
   await page.goto(`${base}/?renderer=${renderer}&controls=0&scene=/tile-fixture.scene.json`);await page.waitForFunction(()=>window.scenePlayer?.ready);
   await page.evaluate(()=>scenePlayer.whenIdle());
   const set=async(type,value)=>page.evaluate(async([type,value])=>{await scenePlayer.setComponent('tile',type,value);await scenePlayer.whenIdle();},[type,value]);
   const capture=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return png(await page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'}));};
   const check=(p,y,value,message,tolerance=4)=>{const actual=p.pixels[(y*p.width+320)*p.channels];assert(Math.abs(actual-value)<=tolerance,`${label}: ${message} y=${y}: ${actual} vs ${value}`);};
   for(const mode of ['transparent','clampBottom','repeatBottom','repeat','clamp']){
    await set('TiledSpriteRenderer',{wrap:{y:mode}});const p=await capture();
    for(const y of [103,115,122,126,129,130,134,138,145,160,205,215,224,229,230,234,242,256,329]){
     const top=cdf((y+.5-130)/8),bottom=cdf((y+.5-230)/8);
     check(p,y,255*(mode==='transparent'?top-bottom:mode==='clampBottom'||mode==='repeatBottom'?top:1),`${mode} Gaussian boundary`);
    }
   }
   // No artificial seam at later repeats, including a kernel wider than the tile.
   {
    await set('TiledSpriteRenderer',{wrap:{y:'repeatBottom'}});await set('GaussianBlur',{sigmaWorld:{x:0,y:.8}});
    const p=await capture();for(const y of [30,80,128,130,180,228,230,280,328,330,358])check(p,y,255*cdf((y+.5-130)/80),'wide half-infinite repeat',5);
   }
   // Glow needs its own padded UV mapping when the body uses native texels.
   await set('TiledSpriteRenderer',{wrap:{y:'transparent'}});await set('GaussianBlur',{enabled:false});await set('Glow',{enabled:true});let p=await capture();
   for(const y of [115,122,126,129,230,234,238,244])check(p,y,255*(cdf((y+.5-130)/8)-cdf((y+.5-230)/8)),'glow outside an opaque tile');
   await set('Glow',{enabled:false});p=await capture();for(const y of [129,130,180,229,230])check(p,y,y>=130&&y<230?255:0,'native bounds restored',0);
   await set('GaussianBlur',{enabled:true,sigmaWorld:{x:0,y:.08}});p=await capture();check(p,126,255*cdf(-3.5/8),'blur restored after native frame');
   await set('GaussianBlur',{enabled:false});await set('TiledSpriteRenderer',{brightness:.2});await set('DropShadow',{enabled:true});p=await capture();
   check(p,240,255*.5*(cdf((240.5-150)/8)-cdf((240.5-250)/8)),'independent shadow color and opacity');
   assert(p.pixels[(240*p.width+320)*p.channels+1]===0,'A red shadow remains red behind darkened art');
   check(p,180,51,'Shadow remains behind the opaque body');
   const jobs=await page.evaluate(()=>scenePlayer.resources.jobs.size);
   await set('DropShadow',{offsetWorld:{x:0,y:.2},opacity:.75});p=await capture();check(p,120,255*.75*cdf((120.5-110)/8),'live shadow offset');
   assert.equal(await page.evaluate(()=>scenePlayer.resources.jobs.size),jobs,'Shadow offset and opacity edits reuse the filtered tile');
   await set('DropShadow',{enabled:false});p=await capture();check(p,120,0,'disabled shadow',0);
   assert.deepEqual(errors,[]);console.log(`${label}: transparent Gaussian edges, glow, wrap modes, wide kernels and live toggles passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
module.exports={fixture};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
