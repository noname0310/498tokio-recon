const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');

function brightBounds(buffer){
  const p=png(buffer),xs=[],ys=[];
  for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)if(p.pixels[(y*p.width+x)*p.channels]>100){xs.push(x);ys.push(y);}
  assert(xs.length);return [Math.min(...xs),Math.min(...ys),Math.max(...xs)+1,Math.max(...ys)+1];
}
async function main(){
  const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`,directory=path.join(root,'test-results/flame_15');fs.mkdirSync(directory,{recursive:true});
  try{for(const [label,type,renderer] of [['dom',chromium,'dom'],['firefox',firefox,'dom'],['babylon',chromium,'babylon']]){
    const executablePath=type===chromium?[chromium.executablePath()].find(fs.existsSync):undefined;
    const browser=await type.launch({headless:true,executablePath});
    try{
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
      if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden');};});
      await page.goto(`${origin}/index.html?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
      const id=await page.evaluate(async()=>{const {Frame}=await import('/runtime/player.js');await scenePlayer.seekFrame(Frame.from(15));await scenePlayer.whenIdle();return [...scenePlayer.scene.nodes.keys()].find(id=>id.endsWith('/effect/burst_a'));});
      assert(id);await page.screenshot({path:path.join(directory,`${label}_fixed.png`)});
      await page.evaluate(id=>scenePlayer.setComponent(id,'Glow',{enabled:false}),id);
      for(const viewport of [{width:640,height:360},{width:1366,height:768},{width:390,height:844}]){
        await page.setViewportSize(viewport);await page.waitForFunction(size=>scenePlayer.view.width===size.width&&scenePlayer.view.height===size.height,viewport);
        await page.evaluate(()=>scenePlayer.whenIdle());
        const expected=await page.evaluate(id=>{
          const p=scenePlayer,s=p.scene,a=s.asset('burst_a'),m=s.world.get(id),v=p.view,state=s.spriteState(id),w=state.size.x/a.pixelsPerUnit,h=state.size.y/a.pixelsPerUnit;
          return [v.width/2+(m[12]-a.pivot.x*w*m[0])*v.pixelsPerUnit,v.height/2-(m[13]+(1-a.pivot.y)*h*m[5])*v.pixelsPerUnit,
            v.width/2+(m[12]+(1-a.pivot.x)*w*m[0])*v.pixelsPerUnit,v.height/2-(m[13]-a.pivot.y*h*m[5])*v.pixelsPerUnit];
        },id);
        const actual=brightBounds(await page.screenshot());for(let i=0;i<4;i++)assert(Math.abs(actual[i]-expected[i])<=1,`${label}: projected texel bound ${actual} vs ${expected}`);
      }
      if(renderer==='babylon'){
        const report=await page.evaluate(async id=>{
          const p=scenePlayer,s=p.scene,asset=s.asset('burst_a'),source=p.resources.crop(await p.resources.image(s,'burst_a'),s.spriteState(id).rect),component=s.component(id,'Glow'),resolution=100;
          const result=await p.resources.texture('effect-alignment-test',{kind:'mask',source,asset,component:{type:'Glow',sigmaWorld:component.sigmaWorld,threshold:component.threshold,softness:component.softness},resolution});
          let mass=0,x=0,y=0,expectedMass=0,expectedX=0,expectedY=0;
          for(let row=0;row<source.height;row++)for(let col=0;col<source.width;col++){
            const i=(row*source.width+col)*4,v=source.data[i+3]/255*(.2126*source.data[i]+.7152*source.data[i+1]+.0722*source.data[i+2])/255;
            expectedMass+=v;expectedX+=v*((col+.5-asset.pivot.x*source.width)/asset.pixelsPerUnit);expectedY+=v*((1-asset.pivot.y)*source.height-row-.5)/asset.pixelsPerUnit;
          }
          for(let row=0;row<result.height;row++)for(let col=0;col<result.width;col++){
            const v=result.data[row*result.width+col]/255;mass+=v;x+=v*(result.bounds.left+(col+.5)/resolution);y+=v*(result.bounds.top-(row+.5)/resolution);
          }
          return {centroidErrorPixels:[(x/mass-expectedX/expectedMass)*resolution,(y/mass-expectedY/expectedMass)*resolution],massRatio:mass/(expectedMass*(resolution/asset.pixelsPerUnit)**2)};
        },id);
        assert(report.centroidErrorPixels.every(v=>Math.abs(v)<.08),`Glow must retain the emitter centroid: ${JSON.stringify(report)}`);
        assert(Math.abs(report.massRatio-1)<.02,`Glow must retain total emission: ${JSON.stringify(report)}`);
        console.log('Glow area integration:',report);
      }
      assert.deepEqual(errors,[]);console.log(`${label}: frame 15 projected bounds at three aspect ratios passed.`);
    }finally{await browser.close();}
  }}finally{await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
