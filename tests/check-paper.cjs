const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const output=path.join(root,'test-results/paper_00_38_58/rendered');

function checkMask(actual,off,on,view,grid,progress,label){
  const a=png(actual),old=png(off),next=png(on),units=view.pixelsPerUnit*view.dpr;
  const norm=Math.hypot(grid.direction.x,grid.direction.y),dx=grid.direction.x/norm,dy=grid.direction.y/norm;
  const extent=Math.abs(dx)*view.worldWidth/2+Math.abs(dy)*view.worldHeight/2,front=-extent+progress*(2*extent+grid.feather);
  const margin=3/units*(2/Math.min(grid.cellSize.x,grid.cellSize.y)+(Math.abs(dx)+Math.abs(dy))/grid.feather);
  let tested=0,bad=0,first;
  for(let y=3;y<a.height-3;y++)for(let x=3;x<a.width-3;x++){
    const wx=(x+.5)/units-view.worldWidth/2,wy=view.worldHeight/2-(y+.5)/units;
    const cx=grid.origin.x+(Math.floor((wx-grid.origin.x)/grid.cellSize.x)+.5)*grid.cellSize.x,cy=grid.origin.y+(Math.floor((wy-grid.origin.y)/grid.cellSize.y)+.5)*grid.cellSize.y;
    const distance=Math.max(2*Math.abs(wx-cx)/grid.cellSize.x,2*Math.abs(wy-cy)/grid.cellSize.y),threshold=(front-wx*dx-wy*dy)/grid.feather;
    if(threshold<1+margin&&Math.abs(threshold-distance)<margin)continue;
    const expected=threshold>=distance?next:old,i=(y*a.width+x)*a.channels;tested++;
    // A sprite may be rasterized at a different fractional coverage after its
    // parent clip becomes composited. Exclude actual content edges as well.
    let edge=false;
    for(const offset of [-1,1,-a.width,a.width])for(let c=0;c<3;c++)if(Math.abs(expected.pixels[i+c]-expected.pixels[i+offset*a.channels+c])>5)edge=true;
    if(edge)continue;
    for(let c=0;c<3;c++)if(Math.abs(a.pixels[i+c]-expected.pixels[i+c])>3){bad++;first??={x,y,c,got:a.pixels[i+c],want:expected.pixels[i+c]};}
  }
  assert(tested>10000);assert.equal(bad,0,`${label}: incoming group mask leak or clipped content: ${JSON.stringify({bad,first})}`);
}

async function main(){
  const {Scene,Frame,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
  const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file)),scene=new Scene(data,pathToFileURL(file).href);
  const at=n=>{scene.setFrameTime(Time.fromFrame(Frame.from(n)),frameRate(30));scene.updateWorld();};
  for(const n of [1144,1145,1146,1158,1145,1146,1219,1220]){at(n);assert.equal(scene.active.get('paper-scene'),scene.active.get('forward-grid-wipe'),'Incoming root and mask share one exact activation track');assert.equal(scene.active.get('paper-plane'),n>=1146&&n<1220);}
  at(1158);const x=scene.world.get('paper-plane')[12];at(1218);assert(Math.abs((scene.world.get('paper-plane')[12]-x)*100-(-.3561977827667422)*60)<.001);
  const authored=data.root.children.find(n=>n.id==='forward-grid-wipe').components.find(c=>c.type==='Transition'),grid=authored.grid;
  const fixture={schemaVersion:1,timeline:{duration:4},assets:{paper:{...data.assets.paper_plane,file:'/assets/paper_flight/paper_plane.png'},sky:{...data.assets.paper_sky,file:'/assets/paper_flight/sky.png'}},root:{id:'root',children:[
    {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
    {id:'old',transform:{localPosition:{z:0}},components:[{type:'TiledSpriteRenderer',asset:'sky',color:{r:.4,g:.1,b:.4,a:1}}]},
    {id:'incoming',children:[
      {id:'sky',transform:{localPosition:{z:5}},components:[{type:'TiledSpriteRenderer',asset:'sky'}]},
      {id:'paper',transform:{localPosition:{x:-1.25,y:.5,z:4},localScale:{x:5,y:5,z:1}},components:[{type:'SpriteRenderer',asset:'paper',color:{r:1,g:1,b:1,a:.75}},{type:'DropShadow',sigmaWorld:.008,offsetWorld:{x:.03,y:-.02}}]}
    ]},
    {id:'mask',transform:{localPosition:{z:-2}},components:[{...structuredClone(authored),target:{entity:'incoming'},progress:0}]}
  ]}};
  const invalid=structuredClone(fixture);invalid.root.children.at(-1).components[0].target.entity='missing';assert.throws(()=>new Scene(invalid,'http://localhost/scene.json'),/Unknown Transition target/);
  const server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));fs.mkdirSync(output,{recursive:true});
  try{for(const [label,type,renderer] of [['dom',chromium,'dom'],['babylon',chromium,'babylon'],['firefox-dom',firefox,'dom']]){
    const executablePath=type===chromium?[chromium.executablePath()].find(fs.existsSync):undefined;
    const browser=await type.launch({headless:true,executablePath});
    try{
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
      if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden');};});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
      let first;
      for(const n of [1145,1146,1151,1158,1219,1220,1151,1145]){
        await page.evaluate(async n=>{const {Frame}=await import('/runtime/player.js');await scenePlayer.seekFrame(Frame.from(n));await scenePlayer.whenIdle();},n);
        const shot=await page.screenshot({path:path.join(output,`${label}_${n}.png`)});
        if(n===1145){if(first){assert(compare(first,shot).mae<.02,'Rewind does not expose incoming paper');}else first=shot;assert.equal(await page.evaluate(()=>scenePlayer.scene.active.get('paper-scene')),false);}
      }
      await page.evaluate(async fixture=>{await scenePlayer.loadScene(fixture);await scenePlayer.seek(0);},fixture);
      for(const viewport of [{width:640,height:360},{width:375,height:812},{width:1001,height:563}]){
        await page.setViewportSize(viewport);await page.waitForFunction(v=>scenePlayer.view.width===v.width&&scenePlayer.view.height===v.height,viewport);
        for(const px of [-1.25,-.73]){
          await page.evaluate(async x=>{await scenePlayer.setTransform('paper',{localPosition:{x}});await scenePlayer.setComponent('mask','Transition',{progress:0});await scenePlayer.whenIdle();},px);
          const off=await page.screenshot();await page.evaluate(()=>scenePlayer.setComponent('mask','Transition',{progress:1}));const on=await page.screenshot();
          const view=await page.evaluate(async()=>{await scenePlayer.setComponent('mask','Transition',{progress:.6});await scenePlayer.whenIdle();return scenePlayer.view;});
          checkMask(await page.screenshot(),off,on,view,grid,.6,`${label}/${viewport.width}/${px}`);
          await page.evaluate(()=>scenePlayer.setComponent('mask','Transition',{progress:0}));assert(compare(off,await page.screenshot()).mae<.02,'Zero mask after full reveal never leaks the incoming group');
        }
      }
      if(renderer==='dom'){
        await page.evaluate(async()=>{await scenePlayer.setComponent('mask','Transition',{progress:.6});window.paperImage=document.querySelector('[data-entity="paper"] img');window.maskPath=document.querySelector('clipPath path');});
        await page.evaluate(async()=>{for(const progress of [.2,1,0,.6])await scenePlayer.setComponent('mask','Transition',{progress});});
        assert(await page.evaluate(()=>window.paperImage===document.querySelector('[data-entity="paper"] img')&&window.maskPath===document.querySelector('clipPath path')),'Masks and incoming DOM objects are retained');
        const changes=await page.evaluate(async()=>{let count=0;const observer=new MutationObserver(records=>count+=records.length);observer.observe(scenePlayer.viewport,{attributes:true,childList:true,subtree:true});await scenePlayer.update();await scenePlayer.whenIdle();count+=observer.takeRecords().length;observer.disconnect();return count;});assert.equal(changes,0,'Unchanged group produces no DOM writes');
      }
      assert.deepEqual(errors,[]);console.log(`${label}: activation boundary, reverse seek, moving paper, whole-group masking, opaque depth isolation, shadow clipping, responsive views and reuse passed.`);
    }finally{await browser.close();}
  }}finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
