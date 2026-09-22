const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');
const output=path.join(root,'test-results/grid_transition_fit/rendered');

// Independent pixel classification from the measured scalar field. It does
// not use the runtime's polygon clipper or inspect generated SVG geometry.
function checkField(bytes,view,transition,label){
  const im=png(bytes),g=transition.grid,n=Math.hypot(g.direction.x,g.direction.y),dx=g.direction.x/n,dy=g.direction.y/n;
  const extent=Math.abs(dx)*view.worldWidth/2+Math.abs(dy)*view.worldHeight/2;
  const front=-extent+transition.progress*(2*extent+g.feather),units=view.pixelsPerUnit*view.dpr;
  function field(x,y){
    const cx=g.origin.x+(Math.floor((x-g.origin.x)/g.cellSize.x)+.5)*g.cellSize.x;
    const cy=g.origin.y+(Math.floor((y-g.origin.y)/g.cellSize.y)+.5)*g.cellSize.y;
    const distance=Math.max(2*Math.abs(x-cx)/g.cellSize.x,2*Math.abs(y-cy)/g.cellSize.y);
    const threshold=(front-dx*x-dy*y)/g.feather;
    return {threshold,margin:threshold-distance};
  }
  let checked=0,covered=0,holes=0,worst=0,bad=0,first;
  for(let y=3;y<im.height-3;y++)for(let x=3;x<im.width-3;x++){
    const px=(x+.5)/units-view.worldWidth/2,py=view.worldHeight/2-(y+.5)/units,value=field(px,py);
    const expected=transition.progress>=1||(transition.progress>0&&value.margin>=0);
    // A Lipschitz bound excludes the antialiased boundary even when a very
    // narrow real gap would fall between discrete neighbourhood probes.
    // SVG edge coverage plus the CSS surface's fractional resampling can
    // extend over two physical pixels (notably in Firefox).
    const waveMargin=2*(Math.abs(dx)+Math.abs(dy))/(units*g.feather);
    const edgeMargin=2*2/(units*Math.min(g.cellSize.x,g.cellSize.y))+waveMargin;
    if(transition.progress<1&&value.threshold<1+waveMargin&&Math.abs(value.margin)<edgeMargin)continue;
    checked++;if(expected)covered++;else holes++;
    const i=(y*im.width+x)*im.channels;
    for(const [channel,color] of [25.5,102,51].entries()){
      const error=Math.abs(im.pixels[i+channel]-(expected?color:0));worst=Math.max(worst,error);
      if(error>2){bad++;first??={x,y,expected,rgb:[...im.pixels.subarray(i,i+3)]};}
    }
  }
  assert(checked>10000&&covered>0,`${label}: enough covered pixels`);
  assert.equal(bad,0,`${label}: cracks or incorrect opacity away from the true boundary: ${JSON.stringify({bad,worst,first})}`);
  return {checked,covered,holes,worst};
}

async function main(){
  const {Scene}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
  const data=JSON.parse(fs.readFileSync(path.join(root,'assets/final_animation.scene.json')));
  const authored=data.root.children.find(n=>n.id==='forward-grid-wipe').components.find(c=>c.type==='Transition');
  assert.equal(authored.kind,'grid');assert(authored.grid.feather>0);
  const fixture={schemaVersion:1,timeline:{duration:2},assets:{},root:{id:'root',children:[
    {id:'camera',transform:{localPosition:{x:0,y:0,z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
    {id:'wipe',components:[{type:'PlaneRenderer',coverage:'camera',color:{r:.2,g:.8,b:.4,a:.5}},{...structuredClone(authored),target:null}]}
  ]}};
  for(const kind of ['unknown',null]){
    const invalid=structuredClone(fixture);invalid.root.children[1].components[1].kind=kind;
    assert.throws(()=>new Scene(invalid,'http://localhost/scene.json'),/Unsupported Transition.kind/);
  }
  const badFeather=structuredClone(fixture);badFeather.root.children[1].components[1].grid.feather=0;
  assert.throws(()=>new Scene(badFeather,'http://localhost/scene.json'),/Transition.grid.feather/);
  const server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));fs.mkdirSync(output,{recursive:true});
  try{
    for(const [label,type,renderer,dpr] of [['dom',chromium,'dom',1],['babylon',chromium,'babylon',1],['firefox-dom',firefox,'dom',1],['dom-dpr125',chromium,'dom',1.25]]){
      const executablePath=type===chromium?[chromium.executablePath()].find(fs.existsSync):undefined;
      const browser=await type.launch({headless:true,executablePath});
      try{
        const page=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:dpr}),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden in DOM');};});
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html?renderer=${renderer}&controls=0`);
        await page.waitForFunction(()=>window.scenePlayer?.ready);
        for(const n of [1147,1150,1154,1155]){
          await page.evaluate(async n=>{const {Frame}=await import('/runtime/player.js');await scenePlayer.seekFrame(Frame.from(n));await scenePlayer.whenIdle();},n);
          await page.screenshot({path:path.join(output,`${label}_${n}.png`)});
          const progress=await page.evaluate(()=>scenePlayer.scene.component('forward-grid-wipe','Transition').progress);
          assert(progress>=0&&progress<=1,'Frame seeks keep transition progress in range');
        }
        await page.evaluate(async fixture=>{await scenePlayer.loadScene(fixture);await scenePlayer.setComponent('wipe','Transition',{progress:.6});},fixture);
        if(renderer==='dom')await page.evaluate(()=>{window.retainedTransition=document.querySelector('.transition-grid path');});
        const cases=[
          {name:'fitted',view:{width:640,height:360},progress:.6,grid:authored.grid},
          {name:'fractional',view:{width:641,height:359},progress:.82,grid:authored.grid},
          {name:'portrait',view:{width:375,height:812},progress:.6,grid:authored.grid},
          {name:'wide',view:{width:1201,height:501},progress:.72,grid:authored.grid},
          {name:'narrow-diagonal',view:{width:641,height:359},progress:.47,grid:{cellSize:{x:.31,y:.47},origin:{x:.013,y:-.021},direction:{x:1,y:.4},feather:.08}},
          {name:'reverse',view:{width:640,height:360},progress:.73,grid:{...authored.grid,direction:{x:-1,y:0}}},
          {name:'completed',view:{width:375,height:812},progress:1,grid:authored.grid}
        ];
        const report=[];
        for(const c of cases){
          await page.setViewportSize(c.view);
          await page.waitForFunction(view=>scenePlayer.view.width===view.width&&scenePlayer.view.height===view.height,c.view);
          const state=await page.evaluate(async c=>{await scenePlayer.setComponent('wipe','Transition',{progress:c.progress,grid:c.grid});await scenePlayer.update();await scenePlayer.whenIdle();return {view:scenePlayer.view,transition:scenePlayer.scene.component('wipe','Transition')};},c);
          const bytes=await page.screenshot({path:path.join(output,`${label}_${c.name}.png`)});
          report.push({case:c.name,...checkField(bytes,state.view,state.transition,`${label}/${c.name}`)});
        }
        await page.evaluate(()=>scenePlayer.setComponent('wipe','Transition',{progress:0}));
        const empty=png(await page.screenshot());
        for(let i=0;i<empty.width*empty.height;i++)for(let c=0;c<3;c++)assert.equal(empty.pixels[i*empty.channels+c],0,'Zero progress hides all retained transition geometry');
        await page.evaluate(()=>scenePlayer.setComponent('wipe','Transition',{enabled:false}));
        const disabled=png(await page.screenshot());
        for(let i=0;i<disabled.width*disabled.height;i++)for(const [c,value] of [25.5,102,51].entries())assert(Math.abs(disabled.pixels[i*disabled.channels+c]-value)<=2,'Disabling a transition shows its plane exactly once');
        if(renderer==='dom'){
          await page.evaluate(()=>scenePlayer.setComponent('wipe','Transition',{enabled:true,progress:.6}));
          assert(await page.evaluate(()=>window.retainedTransition===document.querySelector('.transition-grid path')),'One retained path across progress, direction and viewport changes');
          assert.equal(await page.locator('.transition-grid path').count(),1);
          const writes=await page.evaluate(async()=>{let changes=0;const observer=new MutationObserver(records=>changes+=records.length);observer.observe(scenePlayer.viewport,{attributes:true,childList:true,subtree:true});await scenePlayer.update();await scenePlayer.whenIdle();changes+=observer.takeRecords().length;observer.disconnect();return changes;});
          assert.equal(writes,0,'An unchanged transition makes no DOM writes');
        }
        assert.deepEqual(errors,[]);console.log(`${label}: transition shape, all tile joins, half opacity, dynamic aspect, reverse/diagonal directions, completed coverage and retained geometry passed.`,JSON.stringify(report));
      }finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
