const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');
const {pathToFileURL}=require('node:url');
function fixture(){return {schemaVersion:1,root:{id:'root',children:[
  {id:'camera',transform:{localPosition:{x:.1,y:-.15,z:0},localRotation:{x:3,y:7,z:-4}},components:[{type:'Camera',projection:'perspective',verticalFovDegrees:55,principalPoint:{x:.5,y:.31},referenceVerticalSize:3.6,referenceAspect:16/9,near:.5,far:25}]},
  {id:'parent',transform:{localPosition:{x:.3,y:.2,z:4},localRotation:{x:35,y:-20,z:25}},children:[{id:'plane',components:[{type:'PlaneRenderer',size:{x:2.4,y:1.6},color:{r:1,g:.2,b:.1,a:1}}]}]}
]}};}
async function main(){
 const runtime=await import(pathToFileURL(path.join(root,'dist/runtime/player.js'))),server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [label,engine,renderer]of [['DOM',chromium,'dom'],['Firefox',firefox,'dom'],['Babylon',chromium,'babylon']]){
  const browser=await engine.launch(engine===chromium?{executablePath:[chromium.executablePath()].find(fs.existsSync)}:{});
  try{const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas is forbidden');};});
   await page.goto(`${base}/index.html?scene=assets/intro_background/intro.scene.json&renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
   await page.evaluate(data=>scenePlayer.loadScene(data),fixture());
   for(const size of [{width:640,height:360},{width:390,height:844},{width:1280,height:320}]){
    await page.setViewportSize(size);await page.waitForFunction(s=>scenePlayer.view.width===s.width&&scenePlayer.view.height===s.height,size);await page.evaluate(()=>scenePlayer.whenIdle());
    const {points,view}=await page.evaluate(()=>{
      const s=scenePlayer.scene,v=scenePlayer.view,e=document.querySelector('[data-entity="plane"]');
      const mat=new DOMMatrix(s.cssMatrix('plane',v));
      return {view:v,points:[[-1.2,-.8],[1.2,-.8],[1.2,.8],[-1.2,.8]].map(([x,y])=>{const p=mat.transformPoint(new DOMPoint(x*v.pixelsPerUnit,-y*v.pixelsPerUnit,0));return [v.width/2+p.x/p.w,v.height/2+p.y/p.w];})};
    });
    const shot=png(await page.locator('#viewport').screenshot());let checked=0,bad=0,filled=0;
    for(let y=1;y<shot.height;y+=3)for(let x=1;x<shot.width;x+=3){
      const sides=points.map((a,i)=>{const b=points[(i+1)%4],dx=b[0]-a[0],dy=b[1]-a[1];return ((x+.5-a[0])*dy-(y+.5-a[1])*dx)/Math.hypot(dx,dy);});
      if(Math.min(...sides.map(Math.abs))<2)continue;const inside=sides.every(v=>v>=0)||sides.every(v=>v<=0),at=(y*shot.width+x)*shot.channels,expected=inside?[255,51,26]:[0,0,0];checked++;filled+=inside;
      if(expected.some((v,k)=>Math.abs(v-shot.pixels[at+k])>1))bad++;
    }
    assert(filled>50,`${label}: projection is visible`);assert.equal(bad,0,`${label}: projected plane, ${size.width}x${size.height}, ${checked} pixels`);
   }
   assert.deepEqual(errors,[]);console.log(`${label}: perspective, camera/parent rotation, principal point, portrait and ultrawide passed.`);
  }finally{await browser.close();}
 }}finally{server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
