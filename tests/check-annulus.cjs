const assert=require('node:assert/strict'),{chromium,firefox}=require('playwright');
const {makeServer}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const fixture={schemaVersion:1,assets:{},root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{z:-4}},components:[{type:'Camera',projection:'perspective',verticalFovDegrees:45,referenceVerticalSize:3.6,near:.1,far:30}]},
 {id:'ring',transform:{localRotation:{x:18,y:23}},components:[{type:'PlaneRenderer',shape:'ellipse',innerRadiusRatio:.6,size:{x:3,y:2},color:{r:1,g:1,b:1,a:.6}},{type:'Transition',enabled:false,kind:'stripes',progress:.5,stripes:{direction:{x:0,y:1},period:.2,origin:0}}]}
]}};
async function main(){const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type,renderer]of [['DOM',chromium,'dom'],['Firefox DOM',firefox,'dom'],['Babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true,...type===chromium?{channel:'msedge'}:{}});try{
   const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());await page.evaluate(data=>scenePlayer.loadScene(data),fixture);
   const settle=()=>page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});await settle();
   const shot=()=>page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});
   const points=await page.evaluate(()=>{const s=scenePlayer.scene,v=scenePlayer.view,w=s.world.get('ring'),m=s.viewMatrix;return [[0,0],[1.2,0],[-1.2,0],[0,.8],[0,-.8],[.3,0]].map(([x,y])=>{const p={x:w[0]*x+w[4]*y+w[12],y:w[1]*x+w[5]*y+w[13],z:w[2]*x+w[6]*y+w[14]},q=s.projectCameraPoint({x:m[0]*p.x+m[4]*p.y+m[8]*p.z+m[12],y:m[1]*p.x+m[5]*p.y+m[9]*p.z+m[13],z:m[2]*p.x+m[6]*p.y+m[10]*p.z+m[14]});return {x:Math.round(v.width/2+q.x*v.pixelsPerUnit),y:Math.round(v.height/2-q.y*v.pixelsPerUnit)};});});
   const values=bytes=>{const im=png(bytes);return points.map(p=>im.pixels[(p.y*im.width+p.x)*im.channels]);};
   const original=await shot(),v=values(original);assert(v[0]<2&&v[5]<2,`${name}: hole must be transparent: ${v}`);assert(v.slice(1,5).every(n=>Math.abs(n-153)<3),`${name}: curved band alpha: ${v}`);
   await page.evaluate(()=>scenePlayer.setComponent('ring','PlaneRenderer',{innerRadiusRatio:0}));await settle();assert(Math.abs(values(await shot())[0]-153)<3);
   await page.evaluate(()=>scenePlayer.setComponent('ring','PlaneRenderer',{innerRadiusRatio:1}));await settle();assert(values(await shot()).every(n=>n<2));
   await page.evaluate(()=>scenePlayer.setComponent('ring','PlaneRenderer',{innerRadiusRatio:.6}));await settle();assert(compare(original,await shot()).mae<.001);
   await page.evaluate(()=>scenePlayer.setComponent('ring','Transition',{enabled:true}));await settle();assert(values(await shot())[0]<2,`${name}: procedural transition preserves the hole`);
   const additive=structuredClone(fixture);additive.root.children.push({id:'background',transform:{localPosition:{z:1}},components:[{type:'PlaneRenderer',coverage:'camera',color:{r:.2,g:.3,b:.4,a:1}}]});
   Object.assign(additive.root.children[1].components[0],{innerRadiusRatio:0,blend:'additive',color:{r:.3,g:.2,b:.1,a:.5}});
   await page.evaluate(data=>scenePlayer.loadScene(data),additive);await settle();
   const pixel=bytes=>{const p=png(bytes),i=(points[0].y*p.width+points[0].x)*p.channels;return Array.from(p.pixels.subarray(i,i+3));};
   assert(pixel(await shot()).every((v,i)=>Math.abs(v-[89,102,115][i])<3),`${name}: additive plane weights its color by alpha without dimming the background`);
   await page.evaluate(()=>scenePlayer.setComponent('ring','PlaneRenderer',{blend:'normal'}));await settle();assert(pixel(await shot()).every(v=>Math.abs(v-64)<3),`${name}: normal blending can be restored without recreating the plane`);
   if(renderer==='dom')assert.equal(await page.locator('canvas').count(),0);
   assert.deepEqual(errors,[]);console.log(`${name}: projected annulus, alpha, animated hole and transition clipping passed`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
