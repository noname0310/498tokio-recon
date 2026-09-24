const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright'),{makeServer}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMICAj4DwAD1AHw410Q2gAAAABJRU5ErkJggg==';
function fixture(){return {schemaVersion:1,assets:{pixel:{type:'Sprite',file:pixel,size:{x:1,y:1},pixelsPerUnit:1}},root:{id:'root',children:[
 {id:'camera',components:[{type:'Camera',projection:'perspective',verticalFovDegrees:40,referenceVerticalSize:3.6,near:.1,far:30}]},
 {id:'group',components:[{type:'SortingGroup'}],children:[
  {id:'hull',transform:{localPosition:{x:-.2},localScale:{x:2}},components:[{type:'SpriteRenderer',asset:'pixel',whiteMix:1,color:{r:1,g:0,b:0,a:1},sortingOrder:0}]},
  {id:'pilot',transform:{localPosition:{x:.25,y:.15,z:.0001}},components:[{type:'SpriteRenderer',asset:'pixel',whiteMix:1,color:{r:0,g:1,b:0,a:1},sortingOrder:-1}]}
 ]},
 {id:'other',active:false,components:[{type:'PlaneRenderer',size:{x:1,y:1},color:{r:0,g:0,b:1,a:1}}]}
]}};}
async function main(){const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['firefox-dom',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true,...type===chromium?{executablePath:chromium.executablePath()}:{}});
  try{const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());await page.evaluate(data=>scenePlayer.loadScene(data),fixture());
   const center=async()=>{await page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});const im=png(await page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'})),i=(180*im.width+320)*im.channels;return [...im.pixels.subarray(i,i+3)];};
   let ungroupedGreen=false;
   for(const yaw of [-65,65]){
    await page.evaluate(async yaw=>{const a=yaw*Math.PI/180;await scenePlayer.setTransform('camera',{localPosition:{x:-6*Math.sin(a),y:0,z:-6*Math.cos(a)},localRotation:{y:yaw}});},yaw);
    assert.deepEqual(await center(),[255,0,0],`${name}: hull covers the coplanar pilot at yaw ${yaw}`);
    await page.evaluate(()=>scenePlayer.setComponent('group','SortingGroup',{enabled:false}));ungroupedGreen||=(await center())[1]===255;
    await page.evaluate(()=>scenePlayer.setComponent('group','SortingGroup',{enabled:true}));
    for(const [distance,expected]of [[-1,[0,0,255]],[1,[255,0,0]]]){
     await page.evaluate(async({yaw,distance})=>{const a=yaw*Math.PI/180;await scenePlayer.setTransform('other',{localPosition:{x:distance*Math.sin(a),z:distance*Math.cos(a)},localRotation:{y:yaw}});await scenePlayer.setActive('other',true);},{yaw,distance});
     assert.deepEqual(await center(),expected,`${name}: group retains depth relative to other objects`);
    }
    await page.evaluate(()=>scenePlayer.setActive('other',false));
   }
   assert(ungroupedGreen,'The fixture must expose the old centre-depth ordering failure');
   if(renderer==='dom'){
    const changes=await page.evaluate(async()=>{const records=[],observer=new MutationObserver(r=>records.push(...r));observer.observe(scenePlayer.renderer.world,{attributes:true,childList:true,subtree:true});await scenePlayer.update();await Promise.resolve();observer.disconnect();return records.length;});assert.equal(changes,0,'A stable group must not rewrite or reparent DOM surfaces');
   }
   assert.deepEqual(errors,[]);console.log(`${name}: coplanar composition, camera reversal, external depth and retained surfaces passed.`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
