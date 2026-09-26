const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium,firefox}=require('playwright');
const {makeServer,root}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');
const data=JSON.parse(fs.readFileSync(path.join(root,'assets/gate_interior/gate_interior.scene.json'),'utf8'));
const component=data.root.children.find(n=>n.id==='interior-camera').components.find(c=>c.type==='ViewportFrame');
const color=[210,180,150],clearColor={r:color[0]/255,g:color[1]/255,b:color[2]/255,a:1};
function fixture(){return {schemaVersion:1,presentation:{activeCamera:'framed'},root:{id:'root',children:[
  {id:'framed',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6,referenceAspect:16/9,clearColor},structuredClone(component)]},
  {id:'plain',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6,referenceAspect:16/9,clearColor}]},
]}};}
function distance(x,y,rect,r){const qx=Math.abs(x-rect.x-rect.width/2)-rect.width/2+r,qy=Math.abs(y-rect.y-rect.height/2)-rect.height/2+r;return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;}
function verify(buffer,view,c,enabled=true){
  const shot=png(buffer),v=c.insetsViewport||{left:0,right:0,top:0,bottom:0},w=c.insetsWorld,u=view.pixelsPerUnit;
  const i={left:w.left+v.left*view.worldWidth,right:w.right+v.right*view.worldWidth,top:w.top+v.top*view.worldHeight,bottom:w.bottom+v.bottom*view.worldHeight};
  const xs=Math.min(1,view.worldWidth/Math.max(i.left+i.right,Number.EPSILON)),ys=Math.min(1,view.worldHeight/Math.max(i.top+i.bottom,Number.EPSILON));
  const rect={x:i.left*xs*u,y:i.top*ys*u,width:Math.max(0,view.width-(i.left+i.right)*xs*u),height:Math.max(0,view.height-(i.top+i.bottom)*ys*u)};
  const radius=Math.min(c.radiusWorld*u,rect.width/2,rect.height/2),s=c.innerShadow,off={x:s.offsetWorld.x*u,y:-s.offsetWorld.y*u};
  let checked=0,bad=0,first;
  for(let y=1;y<shot.height;y+=3)for(let x=1;x<shot.width;x+=3){
    const px=(x+.5)/view.dpr,py=(y+.5)/view.dpr,d=distance(px,py,rect,radius),inner=distance(px-off.x,py-off.y,rect,radius);
    if(enabled&&Math.min(Math.abs(d),Math.abs(inner))*view.dpr<1.6)continue;
    const outside=rect.width<=0||rect.height<=0||d>0;
    const expected=!enabled?color:outside?color.map((v,k)=>v*(1-c.color.a)+255*c.color[['r','g','b'][k]]*c.color.a):inner>0?color.map((v,k)=>v*(1-s.opacity*s.color.a)+255*s.color[['r','g','b'][k]]*s.opacity*s.color.a):color;
    const at=(y*shot.width+x)*shot.channels,actual=Array.from(shot.pixels.subarray(at,at+3));checked++;
    if(expected.some((v,k)=>Math.abs(v-actual[k])>1.05)){bad++;first??={x,y,expected,actual};}
  }
  assert(checked>5000);assert.equal(bad,0,JSON.stringify({bad,checked,first}));
}
async function settled(page){await page.evaluate(async()=>{await scenePlayer.whenIdle();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
async function main(){
  const {normalizeScene}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
  normalizeScene(data);
  for(const change of [c=>c.radiusWorld=-1,c=>c.insetsWorld.top=Infinity,c=>c.innerShadow.opacity=2,c=>c.depth=0,c=>c.insetsViewport={right:1.1}]){
    const input=fixture();change(input.root.children[0].components[1]);assert.throws(()=>normalizeScene(input));
  }
  const detached=fixture();detached.root.children.push({id:'invalid',components:[structuredClone(component)]});assert.throws(()=>normalizeScene(detached),/requires Camera/);
  const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{for(const [label,engine,renderer,dpr]of [['Chromium DOM',chromium,'dom',1],['Firefox DOM',firefox,'dom',1],['Babylon',chromium,'babylon',1],['DOM DPR2',chromium,'dom',2],['Babylon DPR2',chromium,'babylon',2]]){
    const browser=await engine.launch(engine===chromium?{executablePath:[chromium.executablePath()].find(fs.existsSync)}:{});
    try{
      const page=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:dpr}),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`${base}/index.html?scene=assets/gate_interior/gate_interior.scene.json&renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
      await page.evaluate(async input=>scenePlayer.loadScene(input),fixture());await settled(page);
      for(const size of [{width:640,height:360},{width:390,height:844},{width:1280,height:320}]){
        await page.setViewportSize(size);await page.waitForFunction(s=>scenePlayer.view.width===s.width&&scenePlayer.view.height===s.height,size);await settled(page);
        const view=await page.evaluate(()=>scenePlayer.view);verify(await page.locator('#viewport').screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),view,component);
      }
      await page.setViewportSize({width:640,height:360});await page.waitForFunction(()=>scenePlayer.view.width===640);await settled(page);
      if(renderer==='dom'){
        assert.equal(await page.locator('canvas').count(),0,'DOM frame stays SVG');
        const mutations=await page.evaluate(async()=>{let count=0;const element=document.querySelector('[data-component="ViewportFrame"]'),observer=new MutationObserver(records=>count+=records.length);observer.observe(element,{attributes:true,childList:true,subtree:true});for(let i=0;i<5;i++)await scenePlayer.update();await Promise.resolve();observer.disconnect();return count;});
        assert.equal(mutations,0,'Unchanged geometry retains the same SVG nodes without mutations');
      }
      const view=await page.evaluate(()=>scenePlayer.view);
      await page.evaluate(async()=>{await scenePlayer.setTransform('framed',{localPosition:{x:3,y:2},localRotation:{z:17}});});await settled(page);verify(await page.locator('#viewport').screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),view,component);
      for(const camera of ['plain','framed','plain','framed']){
        await page.evaluate(async id=>scenePlayer.setCamera(id),camera);await settled(page);verify(await page.locator('#viewport').screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),view,component,camera==='framed');
      }
      for(const enabled of [false,true]){
        await page.evaluate(async enabled=>scenePlayer.setComponent('framed','ViewportFrame',{enabled}),enabled);await settled(page);verify(await page.locator('#viewport').screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),view,component,enabled);
      }
      const expanding={...component,depth:8,insetsWorld:{left:.23,right:.10,top:.23,bottom:.21},insetsViewport:{left:0,right:.5,top:0,bottom:0},radiusWorld:.2};
      await page.evaluate(c=>scenePlayer.setComponent('framed','ViewportFrame',c),expanding);await settled(page);
      for(const size of [{width:640,height:360},{width:390,height:844},{width:1280,height:320}]){
        await page.setViewportSize(size);await settled(page);
        for(const fraction of [.5,.25,0]){
          expanding.insetsViewport.right=fraction;
          await page.evaluate(c=>scenePlayer.setComponent('framed','ViewportFrame',c),expanding);await settled(page);
          verify(await page.locator('#viewport').screenshot({style:'.runtime-loading-status{visibility:hidden!important}'}),await page.evaluate(()=>scenePlayer.view),expanding);
        }
      }
      await page.setViewportSize({width:640,height:360});await settled(page);
      // A title in front of the camera-space frame remains visible outside its
      // aperture; a farther title is covered. The radius never follows width.
      const depthScene=fixture();Object.assign(depthScene.root.children[0].components[1],expanding,{insetsViewport:{left:0,right:.5,top:0,bottom:0}});
      depthScene.root.children.push({id:'title',transform:{localPosition:{x:1.6,y:0,z:-3}},components:[{type:'PlaneRenderer',size:{x:.2,y:.2}}]});
      await page.evaluate(c=>scenePlayer.loadScene(c),depthScene);await settled(page);
      const pixel=async()=>{const p=png(await page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'}));const i=((180*dpr)*p.width+480*dpr)*p.channels;return [...p.pixels.subarray(i,i+3)];};
      assert.deepEqual(await pixel(),[255,255,255],'A foreground title survives the black surround');
      await page.evaluate(()=>scenePlayer.setTransform('title',{localPosition:{z:-1}}));await settled(page);
      assert.deepEqual(await pixel(),[0,0,0],'The same title behind the frame is covered');
      await page.evaluate(c=>scenePlayer.loadScene(c),fixture());await settled(page);
      const collapsed={...component,insetsWorld:{left:4,right:4,top:2,bottom:2}};
      await page.evaluate(async insetsWorld=>scenePlayer.setComponent('framed','ViewportFrame',{insetsWorld}),collapsed.insetsWorld);await settled(page);verify(await page.locator('#viewport').screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),view,collapsed);
      assert.deepEqual(errors,[]);console.log(`${label}: measured geometry, shadow compositing, portrait/ultrawide resize, camera cuts, enable/disable and collapsed aperture passed.`);
    }finally{await browser.close();}
  }}finally{await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
