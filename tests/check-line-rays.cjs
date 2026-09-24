const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright'),{makeServer}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');
const {fixture}=require('./check-planar-depth.cjs');
async function main(){const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true,...type===chromium?{executablePath:chromium.executablePath()}:{}});
  try{const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
   const data=fixture();data.root.children[0].transform={localPosition:{y:1,z:-6},localRotation:{x:10}};
   const c=data.root.children[2].components[0];c.start={x:0,y:-.2};c.end={x:0,y:.2};c.coverage='ray';
   data.root.children.push({id:'front',active:false,transform:{localPosition:{y:.8,z:-1}},components:[{type:'SpriteRenderer',asset:'floor',whiteMix:1,color:{r:1,g:0,b:0,a:1}}]});
   await page.evaluate(data=>scenePlayer.loadScene(data),data);
   const settle=()=>page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   for(const size of [{width:640,height:360},{width:360,height:800},{width:1280,height:320}]){
    await page.setViewportSize(size);await settle();
    const im=png(await page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'}));
    let brightest=0;for(let y=2;y<8;y++)for(let x=Math.floor(im.width/2)-8;x<Math.floor(im.width/2)+8;x++){const i=(y*im.width+x)*im.channels;brightest=Math.max(brightest,Math.min(...im.pixels.subarray(i,i+3)));}
    assert(brightest>210,`${name}: ray cap is visible at the top of ${size.width}x${size.height}`);
    await page.evaluate(()=>scenePlayer.setActive('front',true));await settle();
    const point=await page.evaluate(()=>{const s=scenePlayer.scene,v=scenePlayer.view,m=s.viewMatrix,p={x:m[4]*.8-m[8]+m[12],y:m[5]*.8-m[9]+m[13],z:m[6]*.8-m[10]+m[14]},q=s.projectCameraPoint(p);return {x:Math.round(v.width/2+q.x*v.pixelsPerUnit),y:Math.round(v.height/2-q.y*v.pixelsPerUnit)};});
    const shot=png(await page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'})),i=(point.y*shot.width+point.x)*shot.channels;
    assert.deepEqual([...shot.pixels.subarray(i,i+3)],[255,0,0],`${name}: extending the ray changed transparent depth order`);
    await page.evaluate(()=>scenePlayer.setActive('front',false));await settle();
    if(renderer==='dom')assert.equal(await page.locator('canvas').count(),0);
   }
   await page.setViewportSize({width:360,height:800});await page.evaluate(()=>scenePlayer.setComponent('beam','LineRenderer',{coverage:'segment'}));await settle();
   const im=png(await page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'}));assert.equal(im.pixels[(4*im.width+Math.floor(im.width/2))*im.channels],0,'The fixture must distinguish a ray from a finite line');
   assert.deepEqual(errors,[]);console.log(`${name}: frustum rays, portrait/ultrawide, fixed origin and transparent ordering passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
