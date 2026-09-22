const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png,compare}=require('./pixel-check.cjs');
const output=path.join(root,'test-results/forward_00_28_38/rendered');fs.mkdirSync(output,{recursive:true});
function moments(bytes){const im=png(bytes);let mass=0,x=0,y=0,xx=0,xy=0,yy=0;for(let j=0;j<im.height;j++)for(let i=0;i<im.width;i++){const w=im.pixels[(j*im.width+i)*im.channels]/255;mass+=w;x+=w*i;y+=w*j;xx+=w*i*i;xy+=w*i*j;yy+=w*j*j;}x/=mass;y/=mass;return {mass,x,y,xx:xx/mass-x*x,xy:xy/mass-x*y,yy:yy/mass-y*y};}
async function main(){
  const {Scene,Frame,Time,frameRate}=await import(pathToFileURL(path.join(root,'dist/runtime/player.js')));
  const file=path.join(root,'assets/final_animation.scene.json'),data=JSON.parse(fs.readFileSync(file)),scene=new Scene(data,pathToFileURL(file).href);
  const at=n=>{scene.setFrameTime(Time.fromFrame(Frame.from(n)),frameRate(30));scene.updateWorld();};
  at(864);const stationary=scene.world.get('forward-ship').slice();
  for(const n of [900,1050,1109]){at(n);assert.deepEqual(scene.world.get('forward-ship'),stationary);assert.equal(scene.component('camera','Vignette').enabled,false);}
  assert.equal(scene.parents.get('forward-exhaust').id,'forward-ship');
  for(const n of [846,847,850,851,1109,1117,1154,1155]){at(n);assert.equal(scene.active.get('forward-scene'),n>=851&&n<1155);}
  assert.equal(scene.find('forward-stars').children.length,2,'Only small and large star emitters; no point particles');
  for(const n of scene.find('forward-stars').children){assert(['star_a','star_b'].includes(scene.component(n.id,'ParticleEmitter').asset));assert(scene.component(n.id,'ParticleMotionBlur').enabled);}
  at(1117);assert(scene.transformAt('forward-ship').localScale.x<4);assert(scene.transformAt('forward-ship').localPosition.y>-.86);
  at(900);const states=JSON.stringify(scene.particleStates('forward-stars-0'));at(1130);at(847);at(900);assert.equal(JSON.stringify(scene.particleStates('forward-stars-0')),states);
  at(869);const hue=scene.component('forward-moon','SpriteRenderer').hueDegrees;at(874);assert.equal(scene.component('forward-moon','SpriteRenderer').hueDegrees,hue);at(875);assert.notEqual(scene.component('forward-moon','SpriteRenderer').hueDegrees,hue);at(977);assert.equal(scene.component('forward-moon','SpriteRenderer').hueDegrees,hue);
  const art=png(fs.readFileSync(path.join(root,'assets/forward_flight/ship_rear.png')));assert.equal(art.width,73);assert.equal(art.height,28);assert.equal(art.channels,4);
  assert(art.pixels.every((v,i)=>i%4!==3||v===0||v===255),'Rear ship retains binary alpha');
  const server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(const [label,type,renderer] of [['dom',chromium,'dom'],['babylon',chromium,'babylon'],['firefox-dom',firefox,'dom']]){
      const executablePath=type===chromium?[chromium.executablePath()].find(fs.existsSync):undefined;
      const browser=await type.launch({executablePath,headless:true});
      try{
        const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
        if(renderer==='dom')await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas forbidden');};});
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html?renderer=${renderer}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
        const seek=n=>page.evaluate(async n=>{const {Frame,Time,frameRate}=await import('/runtime/player.js');scenePlayer.pause();scenePlayer.scene.setFrameTime(Time.fromFrame(Frame.from(n)),frameRate(30));scenePlayer.time=n/30;await scenePlayer.update();await scenePlayer.whenIdle();},n);
        let initial;
        for(const n of [847,851,900,960,1109,1117,1144,1147,1149,1152,1155,900]){
          await seek(n);const capture=await page.screenshot({path:path.join(output,`${label}_${n}.png`)});
          if(n===900){if(initial){const diff=compare(initial,capture);assert(diff.max<=32&&diff.mae<.03,'Reused SVG Gaussian filters preserve replay within rasterization rounding');}else{initial=capture;fs.writeFileSync(path.join(output,`${label}_900_first.png`),capture);}}
          if(n===1155){const im=png(capture);for(const [x,y] of [[0,0],[639,0],[0,359],[639,359]])assert(im.pixels[(y*im.width+x)*im.channels+1]>190,'Completed mask reveals the incoming sky at every corner');}
        }
        // The reveal must fill any camera frustum, including a portrait viewport.
        for(const viewport of [{width:375,height:812},{width:1400,height:600}]){await page.setViewportSize(viewport);await seek(1155);const im=png(await page.screenshot());for(const [x,y] of [[0,0],[viewport.width-1,viewport.height-1]])assert(im.pixels[(y*im.width+x)*im.channels+1]>170);}
        await page.setViewportSize({width:640,height:360});
        const fixture={schemaVersion:1,timeline:{duration:2},assets:{point:{type:'Sprite',file:'/assets/starfield/point.png',size:{x:1,y:1},pixelsPerUnit:100}},root:{id:'root',children:[
          {id:'camera',transform:{localPosition:{x:0,y:0,z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
          {id:'particle',transform:{localPosition:{x:-Math.SQRT1_2,y:-Math.SQRT1_2,z:0}},components:[
            {type:'ParticleEmitter',asset:'point',rate:0,bursts:[{time:0,count:1}],speed:{min:2,max:2},direction:{x:1,y:1,z:0},lifetime:{min:2,max:2},startSize:{min:.24,max:.24}},
            {type:'ParticleMotionBlur',enabled:false,shutterSeconds:.3,maxSigmaWorld:1}]}]}};
        await page.evaluate(async data=>{await scenePlayer.loadScene(data);await scenePlayer.seek(.5);},fixture);
        const sharp=moments(await page.screenshot());await page.evaluate(()=>scenePlayer.setComponent('particle','ParticleMotionBlur',{enabled:true}));
        const blur=moments(await page.screenshot({path:path.join(output,`${label}_blur_fixture.png`)}));
        assert(Math.abs(blur.mass/sharp.mass-1)<.08,'Gaussian blur preserves integrated sprite energy');
        assert(Math.hypot(blur.x-sharp.x,blur.y-sharp.y)<1,'Symmetric directional blur preserves the sprite center');
        for(const [value,expected] of [[blur.xx-sharp.xx,150],[blur.yy-sharp.yy,150],[blur.xy-sharp.xy,-150]])assert(Math.abs(value-expected)<25,`Diagonal blur covariance ${value}, expected ${expected}`);
        console.log(label,'directional blur covariance',[(blur.xx-sharp.xx).toFixed(1),(blur.yy-sharp.yy).toFixed(1),(blur.xy-sharp.xy).toFixed(1)].join(', '));
        await page.evaluate(()=>scenePlayer.setComponent('particle','ParticleMotionBlur',{shutterSeconds:0,dilationPixels:.25}));
        const thick=moments(await page.screenshot());
        assert(Math.abs(thick.mass/sharp.mass-2.25)<.12,'A quarter-native-pixel dilation grows a 24 px square to 36 px without scaling its transform');
        assert(Math.hypot(thick.x-sharp.x,thick.y-sharp.y)<1,'Dilation preserves the sprite center');
        await page.evaluate(()=>scenePlayer.setComponent('particle','ParticleMotionBlur',{softnessPixels:.1}));
        const soft=moments(await page.screenshot());
        assert(Math.abs(soft.mass/thick.mass-1)<.05,'Cross-direction softness preserves premultiplied energy');
        for(const increase of [soft.xx-thick.xx,soft.yy-thick.yy])assert(Math.abs(increase-2.4**2)<3,`Isotropic native softness adds variance on both axes: ${increase}`);
        const allocation=await page.evaluate(()=>{const object=scenePlayer.renderer.objects.find(o=>o.id==='particle');window.filterPool=object.pool?.[0];window.filterTexture=object.filter?.texture;return {passes:object.filter?.renderCount,jobs:scenePlayer.resources.jobs.size,nodes:document.querySelectorAll('*').length};});
        await page.evaluate(()=>scenePlayer.setComponent('particle','ParticleMotionBlur',{alphaGain:.5}));
        const faint=moments(await page.screenshot());assert(Math.abs(faint.mass/soft.mass-.5)<.02,'Alpha gain is applied after convolution');
        await page.evaluate(async()=>{for(const time of [.6,.3,.5])await scenePlayer.seek(time);await scenePlayer.setComponent('particle','ParticleMotionBlur',{shutterSeconds:.2,alphaGain:3});await scenePlayer.setComponent('particle','ParticleEmitter',{color:{r:1,g:1,b:1,a:.2}});});
        const faded=png(await page.screenshot());assert(faded.pixels.reduce((maximum,value,i)=>i%faded.channels===0?Math.max(maximum,value):maximum,0)<=52,'Particle opacity remains outside the saturating filter alpha gain');
        const after=await page.evaluate(()=>{const object=scenePlayer.renderer.objects.find(o=>o.id==='particle');return {passes:object.filter?.renderCount,jobs:scenePlayer.resources.jobs.size,nodes:document.querySelectorAll('*').length,samePool:object.pool?.[0]===window.filterPool,sameTexture:object.filter?.texture===window.filterTexture};});
        assert.deepEqual([after.passes,after.jobs,after.nodes],[allocation.passes,allocation.jobs,allocation.nodes],'Motion, alpha gain and color cannot regenerate GPU filters, DOM nodes or texture jobs');assert(after.samePool&&after.sameTexture);
        await page.evaluate(async()=>{await scenePlayer.setComponent('particle','ParticleMotionBlur',{enabled:false});await scenePlayer.setComponent('particle','ParticleEmitter',{color:{r:1,g:1,b:1,a:1}});});
        const disabled=moments(await page.screenshot());assert(Math.abs(disabled.mass/sharp.mass-1)<.01,'Disabling the component restores the unfiltered sprite');
        await page.evaluate(async()=>{await scenePlayer.setComponent('particle','ParticleMotionBlur',{enabled:true,alphaGain:1});await scenePlayer.setTransform('particle',{localPosition:{x:3.5-Math.SQRT1_2,y:-Math.SQRT1_2,z:0}});});
        const clippedTail=moments(await page.screenshot());assert(clippedTail.mass>1&&clippedTail.mass<sharp.mass/2,'Screen culling retains the visible blur tail of an offscreen sprite');
        console.log(`${label}: native dilation, perpendicular softness, alpha gain, opacity order and filter/DOM reuse passed.`);
        const sortedFixture=structuredClone(fixture);sortedFixture.root.children.pop();
        for(const [id,size,last,color] of [['red',.2,4,{r:1,g:0,b:0,a:.5}],['blue',.3,5/3,{r:0,g:0,b:1,a:.5}]])sortedFixture.root.children.push({id,components:[{type:'ParticleEmitter',asset:'point',rate:0,bursts:[{time:0,count:1},{time:1,count:1}],speed:{min:0,max:0},lifetime:{min:2,max:2},startSize:{min:size,max:size},sizeOverLife:[{time:0,value:1},{time:.5,value:last}],sortMode:'sizeAscending',color}]});
        await page.evaluate(async data=>{await scenePlayer.loadScene(data);await scenePlayer.seek(1);},sortedFixture);
        const sortedCapture=await page.screenshot(),sortedPixels=png(sortedCapture),center=(180*sortedPixels.width+320)*sortedPixels.channels;
        // Four translucent squares must composite red(.2), blue(.3), blue(.5),
        // red(.8), despite belonging to different emitter/material batches.
        for(const [channel,value] of [[0,143],[1,0],[2,96]])assert(Math.abs(sortedPixels.pixels[center+channel]-value)<=2,`${label}: global size order across emitters, channel ${channel}`);
        const resources=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,meshes:scenePlayer.renderer.scene?.meshes.length}));
        await page.evaluate(async()=>{for(const time of [1.1,.75,1])await scenePlayer.seek(time);});
        assert.deepEqual(await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,meshes:scenePlayer.renderer.scene?.meshes.length})),resources,'Size ordering reuses DOM surfaces and thin-instance run meshes');
        assert(compare(sortedCapture,await page.screenshot()).max<=1,'Size sorting is deterministic after reverse seek');
        console.log(`${label}: particles composite from small to large across emitters with reused draw batches.`);
        assert.deepEqual(errors,[]);console.log(`Forward ${label}: exact rewind, palette, rear ship, radial particles and responsive grid reveal passed.`);
      }finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
