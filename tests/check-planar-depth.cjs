const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,firefox}=require('playwright'),{makeServer}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');
const floor='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMICAj4DwAD1AHw410Q2gAAAABJRU5ErkJggg==';
function fixture(){return {schemaVersion:1,assets:{floor:{type:'Sprite',file:floor,size:{x:1,y:1},pixelsPerUnit:1}},root:{id:'root',children:[
 {id:'camera',transform:{localPosition:{y:2,z:-4},localRotation:{x:20}},components:[{type:'Camera',projection:'perspective',verticalFovDegrees:55,referenceVerticalSize:3.6,near:.1,far:30}]},
 {id:'floor-parent',children:[{id:'floor',transform:{localRotation:{x:-90}},components:[{type:'TiledSpriteRenderer',asset:'floor',wrap:{x:'repeat',y:'repeat'}}]}]},
 {id:'beam',components:[{type:'LineRenderer',start:{x:0,y:-3},end:{x:0,y:4},width:.1},{type:'Glow',sigmaWorld:.07,intensity:3,color:{r:0,g:1,b:1,a:1},threshold:0,softness:1}]}
]}};}
async function main(){const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;fs.mkdirSync('test-results/planar-depth',{recursive:true});
 try{for(const [name,type,renderer]of [['dom',chromium,'dom'],['firefox',firefox,'dom'],['babylon',chromium,'babylon']]){
  const browser=await type.launch({headless:true,...type===chromium?{executablePath:chromium.executablePath()}:{}});try{const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw Error('DOM canvas forbidden');};});
   await page.goto(`${base}/?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());await page.evaluate(data=>scenePlayer.loadScene(data),fixture());await page.evaluate(()=>scenePlayer.whenIdle());
   for(const [height,yaw,size]of [[0,0,{width:640,height:360}],[.45,10,{width:360,height:800}],[-.3,-12,{width:1280,height:320}]]){
    await page.setViewportSize(size);await page.evaluate(async({height,yaw})=>{await scenePlayer.setTransform('floor-parent',{localPosition:{y:height},localRotation:{z:yaw}});await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},{height,yaw});
    const samples=await page.evaluate(({height})=>{const s=scenePlayer.scene,v=scenePlayer.view,m=s.viewMatrix;return [-.4,-.2,.2,.4].flatMap(dy=>[0,.18].map(x=>{const y=height+dy,q={x:m[0]*x+m[4]*y+m[12],y:m[1]*x+m[5]*y+m[13],z:m[2]*x+m[6]*y+m[14]},p=s.projectCameraPoint(q);return {x:Math.round(v.width/2+p.x*v.pixelsPerUnit),y:Math.round(v.height/2-p.y*v.pixelsPerUnit),dy,core:x===0};}));},{height});
    const shot=await page.locator('#viewport').screenshot({style:'.runtime-loading-status {visibility:hidden!important}'}),im=png(shot);fs.writeFileSync(path.join('test-results/planar-depth',`${name}_${size.width}.png`),shot);
    for(const p of samples){assert(p.x>=0&&p.x<im.width&&p.y>=0&&p.y<im.height);const at=(p.y*im.width+p.x)*im.channels,rgb=Array.from(im.pixels.subarray(at,at+3));
     if(p.dy<0)assert(rgb.every(v=>Math.abs(v-80)<=2),`${name}: core/glow below the floor leaked (${size.width}, ${p.dy}): ${rgb}`);
     else if(p.core)assert(rgb.every(v=>v>230),`${name}: the visible upper core was hidden: ${rgb}`);
    }
   }
   // A finite hard-cropped plane must still write depth for a crossing beam,
   // whose centre is above the floor. Sorting the whole planes cannot do this.
   const crossing=fixture();crossing.root.children[1].children[0].components[0].clipBounds={left:-3,right:3,bottom:-3,top:3};
   await page.setViewportSize({width:640,height:360});await page.evaluate(data=>scenePlayer.loadScene(data),crossing);await page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const crossingPoint=await page.evaluate(()=>{const s=scenePlayer.scene,v=scenePlayer.view,m=s.viewMatrix,y=-.3,q={x:m[4]*y+m[12],y:m[5]*y+m[13],z:m[6]*y+m[14]},p=s.projectCameraPoint(q);return {x:Math.round(v.width/2+p.x*v.pixelsPerUnit),y:Math.round(v.height/2-p.y*v.pixelsPerUnit)};});
   const crossingShot=await page.screenshot({style:'.runtime-loading-status {visibility:hidden!important}'}),crossingPixels=png(crossingShot),crossingAt=(crossingPoint.y*crossingPixels.width+crossingPoint.x)*crossingPixels.channels;
   assert(Array.from(crossingPixels.pixels.subarray(crossingAt,crossingAt+3)).every(v=>Math.abs(v-80)<=2),`${name}: hard crop disabled depth writes for the crossing beam`);
   // Sprites use a separate DOM clipping path from LineRenderer. The bottom
   // half must be hidden without concealing the portion above the same floor.
   const sprite=fixture();sprite.root.children[1].children[0].components[0].clipBounds={left:-3,right:3,bottom:-3,top:3};
   sprite.root.children[2]={id:'sprite',transform:{localScale:{x:2,y:2}},components:[{type:'SpriteRenderer',asset:'floor',color:{r:1,g:0,b:0,a:1},brightness:3}]};
   await page.evaluate(data=>scenePlayer.loadScene(data),sprite);await page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const spriteSamples=await page.evaluate(()=>{const s=scenePlayer.scene,v=scenePlayer.view,m=s.viewMatrix;return [-.3,.3].map(y=>{const q={x:m[4]*y+m[12],y:m[5]*y+m[13],z:m[6]*y+m[14]},p=s.projectCameraPoint(q);return {x:Math.round(v.width/2+p.x*v.pixelsPerUnit),y:Math.round(v.height/2-p.y*v.pixelsPerUnit),hidden:y<0};});});
   const spritePixels=png(await page.screenshot({style:'.runtime-loading-status {visibility:hidden!important}'}));
   for(const p of spriteSamples){const at=(p.y*spritePixels.width+p.x)*spritePixels.channels,rgb=Array.from(spritePixels.pixels.subarray(at,at+3));if(p.hidden)assert(rgb.every(v=>Math.abs(v-80)<=2),`${name}: sprite leaked below the deck: ${rgb}`);else assert(rgb[0]>200&&rgb[1]<3&&rgb[2]<3,`${name}: sprite above deck was hidden: ${rgb}`);}
   // A finite tile strip hides only the middle of a line behind it. Both
   // exposed ends must survive, including the disconnected CSS clip contours.
   const finite=fixture();finite.root.children[1].children[0].components[0].clipBounds={left:-.15,right:.15,bottom:-2,top:2};
   finite.root.children[2].components[0]={type:'LineRenderer',start:{x:-2,y:-.2},end:{x:2,y:-.2},width:.08};
   await page.setViewportSize({width:640,height:360});await page.evaluate(data=>scenePlayer.loadScene(data),finite);await page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const finiteSamples=await page.evaluate(()=>{const s=scenePlayer.scene,v=scenePlayer.view,m=s.viewMatrix;return [-.6,0,.6].map(x=>{const y=-.2,q={x:m[0]*x+m[4]*y+m[12],y:m[1]*x+m[5]*y+m[13],z:m[2]*x+m[6]*y+m[14]},p=s.projectCameraPoint(q);return {x:Math.round(v.width/2+p.x*v.pixelsPerUnit),y:Math.round(v.height/2-p.y*v.pixelsPerUnit),hidden:x===0};});});
   const finiteShot=await page.screenshot({style:'.runtime-loading-status {visibility:hidden!important}'}),finitePixels=png(finiteShot);fs.writeFileSync(path.join('test-results/planar-depth',`${name}_finite.png`),finiteShot);
   for(const p of finiteSamples){const at=(p.y*finitePixels.width+p.x)*finitePixels.channels,rgb=Array.from(finitePixels.pixels.subarray(at,at+3));if(p.hidden)assert(rgb.every(v=>Math.abs(v-80)<=2),`${name}: finite floor leaked: ${rgb}`);else assert(rgb.every(v=>v>230),`${name}: finite floor hid an exposed end: ${rgb}`);}
   assert.deepEqual(errors,[]);console.log(`${name}: real floor intersection clips core and glow after parent motion and viewport changes.`);
  }finally{await browser.close();}
 }}finally{server.close();}}
module.exports={fixture};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
