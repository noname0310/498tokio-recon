const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const directory=path.join(root,'test-results/landscape_001227'),scenePath='/assets/paper_landscape/sky.scene.json';
function statistics(buffer){
  const image=png(buffer),sum=[0,0,0],square=[0,0,0],count=image.width*image.height;
  for(let i=0;i<count;i++)for(let c=0;c<3;c++){const value=image.pixels[i*image.channels+c];sum[c]+=value;square[c]+=value*value;}
  const mean=sum.map(value=>value/count),std=square.map((value,c)=>Math.sqrt(Math.max(0,value/count-mean[c]**2)));
  return {mean,std};
}
async function main(){
  const server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,report={};
  fs.mkdirSync(directory,{recursive:true});
  try{for(const [label,type,renderer] of [['dom',chromium,'dom'],['babylon',chromium,'babylon'],['firefox',firefox,'dom']]){
    const executablePath=type===chromium?[chromium.executablePath()].find(fs.existsSync):undefined;
    const browser=await type.launch({headless:true,executablePath});
    try{
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden');};window.OffscreenCanvas=class{constructor(){throw new Error('OffscreenCanvas forbidden');}};});
      await page.goto(`${origin}/index.html?scene=${scenePath}&renderer=${renderer}&controls=0`);
      await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
      const initial=await page.screenshot({path:path.join(directory,`sky_${label}.png`)}),stats=statistics(initial);
      for(let c=0;c<3;c++)assert(Math.abs(stats.mean[c]-[136,219,232][c])<2,`${label}: mean sky color ${stats.mean}`);
      assert(stats.std[0]>2.5&&stats.std[0]<3.8&&stats.std[1]>.8&&stats.std[1]<1.6&&stats.std[2]>.8&&stats.std[2]<1.8,`${label}: measured channel contrast ${stats.std}`);
      await page.evaluate(()=>{window.originalGain=structuredClone(scenePlayer.scene.requireComponent('sky','ProceduralNoise').channelGain);window.originalJob=scenePlayer.resources.noise(scenePlayer.scene.requireComponent('sky','ProceduralNoise'));window.originalTextureURL=document.querySelector('.noise')?.style.backgroundImage;});
      await page.evaluate(()=>scenePlayer.setComponent('sky','ProceduralNoise',{channelGain:{r:0,g:1,b:0}}));
      const altered=statistics(await page.screenshot());
      assert(altered.std[0]<.01&&altered.std[2]<.01&&altered.std[1]>1,`${label}: independent channels remain live`);
      assert(await page.evaluate(()=>window.originalJob===scenePlayer.resources.noise(scenePlayer.scene.requireComponent('sky','ProceduralNoise'))),'Channel edits reuse the generated scalar field');
      if(renderer==='dom')assert(await page.evaluate(()=>window.originalTextureURL===document.querySelector('.noise').style.backgroundImage),'Channel edits retain the DOM texture');
      await page.evaluate(()=>scenePlayer.setComponent('sky','ProceduralNoise',{channelGain:window.originalGain}));
      assert.equal(compare(initial,await page.screenshot()).max,0,'Restoring channel gains reproduces the original pixels');
      await page.evaluate(()=>scenePlayer.setComponent('sky','ProceduralNoise',{enabled:false}));
      assert(statistics(await page.screenshot()).std.every(value=>value<.01),'Disabling the component produces a flat sky');
      await page.evaluate(()=>scenePlayer.setComponent('sky','ProceduralNoise',{enabled:true}));
      if(renderer==='dom'){
        const writes=await page.evaluate(async()=>{let count=0;const observer=new MutationObserver(records=>count+=records.length);observer.observe(scenePlayer.viewport,{attributes:true,childList:true,subtree:true});await scenePlayer.update();await scenePlayer.whenIdle();count+=observer.takeRecords().length;observer.disconnect();return count;});
        assert.equal(writes,0,'An unchanged colored-noise update does not write the DOM');
      }
      // Exercise the separate SpriteRenderer filter with a binary-alpha sprite.
      await page.evaluate(async()=>{const data=structuredClone(scenePlayer.scene.data);data.assets.grass={type:'Sprite',file:'/assets/paper_landscape/grass_tile.png',size:{x:14,y:5},pixelsPerUnit:100,pivot:{x:.5,y:.5},filter:'point'};const sky=data.root.children.find(node=>node.id==='sky');sky.transform.localScale={x:10,y:10,z:1};sky.components[0]={type:'SpriteRenderer',asset:'grass',color:{r:1,g:1,b:1,a:.65}};sky.components[1].worldSize={x:.14,y:.05};sky.components[1].origin={x:-.07,y:.025};await scenePlayer.loadScene(data);await scenePlayer.whenIdle();});
      const textured=await page.screenshot();await page.evaluate(()=>scenePlayer.setComponent('sky','ProceduralNoise',{enabled:false}));const plain=await page.screenshot();
      const a=png(textured),b=png(plain);let changed=0;
      for(let i=0;i<a.width*a.height;i++){
        const ai=i*a.channels,bi=i*b.channels,empty=b.pixels[bi]+b.pixels[bi+1]+b.pixels[bi+2]===0;
        for(let c=0;c<3;c++){if(empty)assert.equal(a.pixels[ai+c],0,'Noise does not fill transparent sprite cells');if(a.pixels[ai+c]!==b.pixels[bi+c])changed++;}
      }
      assert(changed>100,'Colored secondary noise affects the sprite body');assert.deepEqual(errors,[]);
      report[label]=stats;console.log(`${label}: sky contrast, channel edits, retained noise, deterministic restore and sprite transparency passed.`);
    }finally{await browser.close();}
  }}finally{await new Promise(resolve=>server.close(resolve));}
  fs.writeFileSync(path.join(directory,'rendered_sky_stats.json'),JSON.stringify(report,null,2)+'\n');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
