const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{pathToFileURL}=require("node:url");
const {chromium}=require("playwright"),{makeServer}=require("./serve.cjs"),{png}=require("./pixel-check.cjs");
const root=path.resolve(__dirname,".."),source=JSON.parse(fs.readFileSync(path.join(root,"assets/exhaust/exhaust.scene.json"),"utf8"));
const asset=source.assets.exhaust;
function fixture(emitter={},parent=[]){return {schemaVersion:1,timeline:{duration:8},assets:{art:{...asset,file:"/assets/exhaust/exhaust_atlas.png"}},root:{id:"scene",children:[{id:"camera",transform:{localPosition:{x:0,y:0,z:-10}},components:[{type:"Camera",referenceVerticalSize:3.6}]},{id:"parent",components:parent,children:[{id:"effect",components:[{type:"ParticleEmitter",asset:"art",rate:4,seed:123,lifetime:{min:1,max:1},startSize:{min:.6,max:.6},direction:{x:-1,y:0,z:0},...emitter}]}]}]}};}
async function numerical(){
  const {Scene}=await import(pathToFileURL(path.join(root,"dist/runtime/player.js"))),{mulberry32}=await import(pathToFileURL(path.join(root,"dist/runtime/player.js")));
  const saved=Math.random;Math.random=()=>{throw new Error("Particle code used Math.random");};
  try{
    const random=mulberry32(1);assert.deepEqual(Array.from({length:5},random),[.6270739405881613,.002735721180215478,.5274470399599522,.9810509674716741,.9683778982143849]);
    const scene=new Scene(source,"http://localhost/assets/exhaust/exhaust.scene.json"),at=t=>{scene.time=t;scene.updateWorld();return scene.particleStates("exhaust");};
    assert.equal(scene.component("exhaust","ParticleEmitter").space,"local","The reconstructed exhaust belongs to its nozzle space");
    const direct=JSON.stringify(at(4.5));for(let i=0;i<150;i++)at(i/30);assert.equal(JSON.stringify(at(4.5)),direct);
    for(const t of [6,2,.1,4.5,7,1,4.5])at(t);assert.equal(JSON.stringify(at(4.5)),direct);
    scene.setComponent("exhaust","ParticleEmitter",{seed:28036});assert.notEqual(JSON.stringify(at(4.5)),direct);scene.setComponent("exhaust","ParticleEmitter",{seed:28035});assert.equal(JSON.stringify(at(4.5)),direct);
    const s=new Scene(fixture(),"http://localhost/");assert.equal(s.component("effect","ParticleEmitter").space,"local");assert.deepEqual(s.particleStates("effect",.5).map(p=>p.position.x),[-.5,-.25,0]);
    const accelerating=new Scene(fixture({rate:0,bursts:[{time:0,count:1}],speed:{min:2,max:2},lifetime:{min:2,max:2},speedOverLife:[{time:0,value:0},{time:.5,value:2},{time:1,value:0}]}),'http://localhost/');
    for(const [time,x] of [[.5,-.5],[1,-2],[1.5,-3.5]])assert.equal(accelerating.particleStates('effect',time)[0].position.x,x,'Speed curve position is its exact integral');
    accelerating.setComponent('effect','ParticleEmitter',{speedOverLife:[{time:0,value:1,interpolation:'step'},{time:.5,value:3,interpolation:'step'},{time:1,value:1}]});assert.equal(accelerating.particleStates('effect',1.5)[0].position.x,-5);
    const blurFixture=fixture({rate:0,bursts:[{time:0,count:1}],speed:{min:2,max:2},lifetime:{min:2,max:2}});
    blurFixture.root.children[1].children[0].components.push({type:'ParticleMotionBlur',shutterSeconds:.3,maxSigmaWorld:1});
    const blurred=new Scene(blurFixture,'http://localhost/'),blurredState=blurred.particleStates('effect',.5)[0];
    assert.equal(blurredState.matrix[0],.6);assert.equal(blurredState.matrix[5],.6,'Motion blur must never stretch sprite geometry');
    assert(Math.abs(blurredState.blurUV.x+2*.3/Math.sqrt(12)/.6)<1e-12);assert.equal(blurredState.blurUV.y,0);
    blurred.setComponent('effect','ParticleMotionBlur',{enabled:false});assert.deepEqual(blurred.particleStates('effect',.5)[0].matrix,blurredState.matrix);assert.equal(blurred.particleStates('effect',.5)[0].blurUV.x,0);
    blurred.setComponent('effect','ParticleMotionBlur',{enabled:true,dilationPixels:.5,softnessPixels:.3,alphaGain:2});assert.deepEqual(blurred.particleStates('effect',.5)[0],blurredState,'Outline and opacity effects cannot alter geometry, particle IDs or the seeded simulation');
    for(const [key,value] of [['dilationPixels',-1],['softnessPixels',NaN],['alphaGain',-1]])assert.throws(()=>blurred.setComponent('effect','ParticleMotionBlur',{[key]:value}));
    s.setComponent("effect","ParticleEmitter",{prewarm:1});assert.equal(s.particleStates("effect",0).length,4);
    s.setComponent("effect","ParticleEmitter",{prewarm:0,start:{frame:2,rate:{numerator:1,denominator:1}},duration:1});assert.equal(s.particleStates("effect",1.999).length,0);assert.equal(s.particleStates("effect",3.5).length,1);assert.equal(s.particleStates("effect",4).length,0);
    s.setComponent("effect","ParticleEmitter",{rate:0,start:{frame:0,rate:{numerator:1,denominator:1}},duration:0,bursts:[{time:.25,count:7}],maxParticles:3});assert.equal(s.particleStates("effect",.2).length,0);assert.equal(s.particleStates("effect",.5).length,3);assert.equal(s.particleStates("effect",1.25).length,0);
    const moving=new Scene(fixture({space:"world",rate:2,speed:{min:0,max:0},lifetime:{min:2,max:2}},[{type:"TransformAnimator",position:[{time:0,value:{x:0,y:0,z:0}},{time:1,value:{x:10,y:0,z:0}}]}]),"http://localhost/");
    assert.deepEqual(moving.particleStates("effect",1).map(p=>p.position.x),[0,5,10],"World particles retain their birth transform, including ancestors");
    moving.setComponent("effect","ParticleEmitter",{space:"local"});assert.deepEqual(moving.particleStates("effect",1).map(p=>p.position.x),[10,10,10],"Local particles follow the current parent");
    moving.setComponent("effect","ParticleEmitter",{rate:0,bursts:[{time:0,count:1}],acceleration:{x:0,y:-2,z:0},sizeOverLife:[{time:0,value:1},{time:1,value:3}],colorOverLife:[{time:0,value:{r:1,g:1,b:1,a:1}},{time:1,value:{r:1,g:1,b:1,a:0}}],animation:{mode:"fps",framesPerSecond:15,loop:true}});
    const p=moving.particleStates("effect",1)[0];assert.equal(p.position.y,-1);assert.equal(p.color.a,.5);assert.equal(p.matrix[5],1.2);assert.equal(p.frame,3);
    const attached=new Scene(fixture({rate:0,bursts:[{time:0,count:1}],lifetime:{min:3,max:3},billboard:"local"},[{type:"TransformAnimator",position:[{time:0,value:{x:0,y:0,z:0}},{time:1,value:{x:3,y:4,z:0}}],rotation:[{time:0,value:{x:0,y:0,z:0}},{time:1,value:{x:0,y:0,z:90}}],scale:[{time:0,value:{x:1,y:1,z:1}},{time:1,value:{x:2,y:3,z:1}}]}]),"http://localhost/");
    attached.setTransform("effect",{localPosition:{x:2,y:0,z:0}});
    const inherited=attached.particleStates("effect",1)[0];assert.deepEqual(inherited.localPosition,{x:-1,y:0,z:0});
    for(const [actual,expected] of [[inherited.position.x,3],[inherited.position.y,6],[inherited.matrix[1],1.2],[inherited.matrix[4],-1.8]])assert(Math.abs(actual-expected)<1e-12,"Existing local particles inherit animated translation, rotation and scale");
    assert.equal(inherited.id,attached.particleStates("effect",.25)[0].id,"Parent motion does not respawn the particle");
    const palette=new Scene(fixture({rate:0,bursts:[{time:0,count:2048}],maxParticles:2048,lifetime:{min:2,max:2},animation:{mode:"random"}}),"http://localhost/");
    const uncolored=palette.particleStates("effect",.5);
    palette.setComponent("effect","ParticleEmitter",{colorPalette:[{weight:1,color:{r:1,g:0,b:0,a:1}},{weight:3,color:{r:0,g:0,b:1,a:1}}]});
    const colored=palette.particleStates("effect",.5),red=colored.filter(p=>p.color.r===1).length;
    assert(red>410&&red<615,"Weighted palette preserves the requested approximate 1:3 frequency");
    assert.deepEqual(colored.map(({color,...state})=>state),uncolored.map(({color,...state})=>state),"Palette sampling cannot change motion, lifetime or atlas randomness");
    assert.deepEqual(palette.particleStates("effect",1).map(p=>p.color),colored.map(p=>p.color),"Birth color stays fixed for the particle lifetime");
    assert.deepEqual(palette.particleStates("effect",.5),colored,"Palette replay is independent of seek order");
    for(const colorPalette of [[{weight:0,color:{r:1,g:1,b:1,a:1}}],[{weight:-1,color:{r:1,g:1,b:1,a:1}}],[{weight:1,color:{r:2,g:1,b:1,a:1}}]])assert.throws(()=>new Scene(fixture({colorPalette}),"http://localhost/"));
    for(const bad of [{seed:-1},{seed:4294967296},{seed:1.5},{direction:{x:0,y:0,z:0}},{lifetime:{min:0,max:1}},{animation:{frame:4}},{sizeOverLife:[{time:1,value:1},{time:0,value:2}]}])assert.throws(()=>new Scene(fixture(bad),"http://localhost/"));
    console.log("Particles: Mulberry32 reference sequence, direct seek/rewind, seed isolation, rates/bursts/capacity, parent transforms, acceleration, lifetime curves and validation passed.");
  }finally{Math.random=saved;}
}
async function browserChecks(){
  const server=makeServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));let browser;
  try{
    const executablePath=[process.env.TOKIO_CHROME,chromium.executablePath()].filter(Boolean).find(fs.existsSync);
    browser=await chromium.launch({executablePath,headless:true});const url=`http://127.0.0.1:${server.address().port}`;let baseline;
    const atlas=png(fs.readFileSync(path.join(root,"assets/exhaust/exhaust_atlas.png"))),padding=asset.atlas.padding||0,stride=6+2*padding;assert.equal(atlas.channels,4);assert.equal(atlas.width,asset.size.x);assert.equal(atlas.height,asset.size.y);
    for(const mode of ["dom","babylon"]){
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
      if(mode==="dom")await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error("Canvas is forbidden");};});
      await page.goto(`${url}/index.html?scene=assets/exhaust/exhaust.scene.json&renderer=${mode}&time=4.5&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
      await page.evaluate(()=>scenePlayer.whenIdle());
      const preparedJobs=await page.evaluate(()=>scenePlayer.resources.jobs.size);
      const state=await page.evaluate(()=>JSON.stringify(scenePlayer.scene.particleStates("exhaust")));if(baseline)assert.equal(state,baseline,"Backends must share exactly the same particle states");else baseline=state;
      const before=await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"});await page.evaluate(async()=>{for(const t of [0,1,6,2,4.5])await scenePlayer.seek(t);});assert(before.equals(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"})),`${mode}: seek back produces the identical image`);
      await page.evaluate(()=>scenePlayer.setComponent("exhaust","ParticleEmitter",{seed:57}));assert(!before.equals(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"})));await page.evaluate(()=>scenePlayer.setComponent("exhaust","ParticleEmitter",{seed:28035}));assert(before.equals(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"})));
      await page.evaluate(async()=>{const {Frame,frameRate}=await import("/runtime/player.js");for(let i=0;i<210;i++)await scenePlayer.seekFrame(Frame.from(i),frameRate(30));});
      const resources=await page.evaluate(()=>{const e=scenePlayer.renderer.objects.find(o=>o.id==="exhaust");return {count:e.count,pool:e.pool?.length,meshes:scenePlayer.renderer.scene?.meshes.length,instances:e.entries?.map(x=>x.mesh.thinInstanceCount),textures:scenePlayer.renderer.scene?.textures.length,jobs:scenePlayer.resources.jobs.size};});
      if(mode==="dom"){assert.equal(await page.locator("canvas").count(),0);assert(resources.pool<=24,"DOM pool must be reused");}else{assert.equal(resources.meshes,2,"One thin-instance mesh plus one glow mesh");assert.deepEqual(resources.instances,[resources.count,resources.count]);assert(resources.textures<=4);}
      assert.equal(resources.jobs,preparedJobs,"Particle animation must reuse all prepared glow masks");
      // Isolated, large, opaque atlas pixels test both UV selection and alpha.
      const data=fixture({rate:0,bursts:[{time:0,count:1}],speed:{min:0,max:0},lifetime:{min:10,max:10},animation:{mode:"single",frame:0}});
      await page.evaluate(async data=>{await scenePlayer.loadScene(data);await scenePlayer.seek(.2);await scenePlayer.whenIdle();},data);
      let checked=0;
      for(let frame=0;frame<4;frame++){
        await page.evaluate(frame=>scenePlayer.setComponent("effect","ParticleEmitter",{animation:{frame}}),frame);const capture=png(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}));
        for(let y=0;y<6;y++)for(let x=0;x<6;x++){
          const at=((y+padding)*atlas.width+frame*stride+padding+x)*4,out=((150+y*10+5)*capture.width+290+x*10+5)*capture.channels;
          for(let c=0;c<3;c++)assert(Math.abs(capture.pixels[out+c]-(atlas.pixels[at+3]?atlas.pixels[at+c]:0))<=2,`${mode} frame ${frame}, cell ${x},${y}`);checked++;
        }
      }
      await page.evaluate(async()=>{await scenePlayer.setComponent("effect","ParticleEmitter",{billboard:"local",animation:{frame:1}});await scenePlayer.setTransform("effect",{localPosition:{x:.15,y:0,z:0}});await scenePlayer.setTransform("parent",{localPosition:{x:.4,y:.2,z:0},localRotation:{x:0,y:0,z:90},localScale:{x:2,y:2,z:2}});});
      const inherited=png(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}));
      for(let y=0;y<6;y++)for(let x=0;x<6;x++){
        const sx=Math.round(360-20*(2.5-y)),sy=Math.round(130-20*(x-2.5)),out=(sy*inherited.width+sx)*inherited.channels,at=((y+padding)*atlas.width+stride+padding+x)*4;
        for(let c=0;c<3;c++)assert(Math.abs(inherited.pixels[out+c]-(atlas.pixels[at+3]?atlas.pixels[at+c]:0))<=2,`${mode}: local particle cell ${x},${y} follows its transformed parent`);
      }
      await page.evaluate(async()=>{await scenePlayer.setTransform("effect",{localPosition:{x:0,y:0,z:0}});await scenePlayer.setTransform("parent",{localPosition:{x:0,y:0,z:0},localRotation:{x:0,y:0,z:0},localScale:{x:1,y:1,z:1}});});
      await page.evaluate(()=>scenePlayer.setComponent("effect","ParticleEmitter",{enabled:false}));const blank=png(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}));assert(blank.pixels.every((v,i)=>i%blank.channels===3||v===0),"Zero instances must not draw a host quad");
      await page.evaluate(()=>scenePlayer.setComponent("effect","ParticleEmitter",{enabled:true}));
      await page.evaluate(()=>scenePlayer.setTransform("parent",{localPosition:{x:0,y:0,z:-11}}));
      const clipped=png(await page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}));assert(clipped.pixels.every((v,i)=>i%clipped.channels===3||v===0),"Particles behind the camera are clipped");
      await page.evaluate(()=>scenePlayer.setTransform("parent",{localPosition:{x:0,y:0,z:0}}));
      await page.setViewportSize({width:360,height:640});await page.evaluate(()=>scenePlayer.whenIdle());assert(Math.abs(await page.evaluate(()=>scenePlayer.view.worldWidth)-6.4)<1e-9);
      await page.keyboard.press("a");assert.equal(await page.evaluate(()=>scenePlayer.scene.data.presentation.referenceAspect),true);
      assert.deepEqual(errors,[]);console.log(`${mode}: 210 frames, identical seek/seed replay, ${checked} atlas cells, reused pools, clipping, responsive camera passed.`);await page.close();
    }
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
(async()=>{await numerical();await browserChecks();})().catch(e=>{console.error(e);process.exitCode=1;});
