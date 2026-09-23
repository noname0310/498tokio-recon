const {chromium}=require("playwright"),{makeServer}=require("./serve.cjs"),{png,compare,checkClamp}=require("./pixel-check.cjs");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),output=process.env.TOKIO_CHECK_OUTPUT?path.resolve(process.env.TOKIO_CHECK_OUTPUT):null,sourceURL="/assets/intro_background/intro.scene.json";
const authored=JSON.parse(fs.readFileSync(path.join(root,sourceURL),"utf8"));
function alternative(origin){
  const data=structuredClone(authored);data.name="Generic runtime fixture";data.root.id="test-root";data.root.name="Test root";
  data.assets={tiles:structuredClone(data.assets.background),orb:structuredClone(data.assets.moon),rect:{type:"Sprite",file:origin+"/tests/fixtures/rect_sprite.png",size:{x:2,y:3},pixelsPerUnit:4,pivot:{x:.2,y:.8},filter:"point"}};
  const camera=data.root.children[0];camera.id="view-main";camera.name="View";camera.components=camera.components.filter(c=>c.type==="Camera");
  const group={id:"actors",name:"Actors",active:true,transform:{localPosition:{x:.4,y:.2,z:0},localRotation:{x:0,y:0,z:13},localScale:{x:1.1,y:1.1,z:1.1}},components:[],children:[]};
  const first=structuredClone(data.root.children[2]);first.id="actor-a";first.name="A";first.components.find(c=>c.type==="SpriteRenderer").asset="orb";
  first.transform.localPosition.x=-.7;first.components=first.components.filter(c=>c.type!=="Glow");
  first.components.find(c=>c.type==="SpriteRenderer").color={r:.8,g:1,b:.9,a:.55};
  const second=structuredClone(first);second.id="actor-b";second.name="B";second.transform.localPosition.x=.7;second.components=second.components.filter(c=>c.type!=="DropShadow");second.components[0].hueDegrees=120;
  group.children=[first,second];
  const rect={id:"small-rect",name:"Non-square sprite",active:true,transform:{localPosition:{x:1.7,y:-.5,z:-.5}},components:[{type:"SpriteRenderer",asset:"rect"}],children:[]};
  const camera2=structuredClone(camera);camera2.id="view-alt";camera2.transform.localPosition.x=.7;camera2.components[0].referenceVerticalSize=4.5;
  data.root.children=[camera,group,rect,camera2];return data;
}
(async()=>{
  assert.deepEqual(fs.readdirSync(path.join(root,"assets/intro_background")).sort(),["background.png","intro.scene.json","moon.png"],"A scene folder contains data assets only");
  if(output)fs.mkdirSync(output,{recursive:true});const server=makeServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin=`http://127.0.0.1:${server.address().port}`;
  const executablePath=[process.env.TOKIO_CHROME,chromium.executablePath()].filter(Boolean).find(fs.existsSync);
  const browser=await chromium.launch({executablePath,headless:true});const report={};
  try{
    for(const mode of ["dom","babylon"]){
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[],requests=[];
      page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});page.on("request",r=>requests.push(r.url()));
      await page.route(/^https?:/,route=>route.request().url().startsWith(origin+"/")?route.continue():route.abort());
      if(mode==="dom")await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error("Canvas is forbidden");};});
      await page.goto(`${origin}/index.html?scene=${sourceURL}&renderer=${mode}`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
      const call=(method,...args)=>page.evaluate(async({method,args})=>{await scenePlayer[method](...args);await scenePlayer.whenIdle();},{method,args});
      const capture=name=>page.screenshot({style:".runtime-loading-status { visibility: hidden !important; }",...output?{path:path.join(output,`${mode}_${name}.png`)}:{},animations:"disabled"});
      const initial=await capture("reference");
      await call("setComponent","moon","ProceduralNoise",{enabled:false});
      const withoutMoonNoise=await capture("without_moon_noise"),previous=fs.readFileSync(path.join(root,`tests/fixtures/intro_${mode}.png`)),visual=compare(withoutMoonNoise,previous);
      assert(visual.mae<.05&&visual.max<=5,`${mode} must preserve the approved scene when moon noise is disabled: ${JSON.stringify(visual)}`);
      const moonNoise=compare(initial,withoutMoonNoise);assert(moonNoise.max>5&&moonNoise.mae>.01,"Secondary texture must visibly affect the moon");
      const noisy=png(initial),plain=png(withoutMoonNoise);
      for(let y=0;y<360;y++)for(let x=0;x<640;x++)if(x<280||x>=360||y<140||y>=220){
        const at=(y*640+x)*noisy.channels;for(let c=0;c<3;c++)assert.equal(noisy.pixels[at+c],plain.pixels[at+c],"Sprite noise must not cover the surrounding scene");
      }
      await call("setComponent","moon","ProceduralNoise",{enabled:true});
      assert.equal(requests.filter(u=>u===origin+sourceURL).length,1,"Each backend reads the same JSON URL directly");
      assert.equal(await page.locator('script[type="application/json"]').count(),0,"HTML must not contain copied scene data");
      const initialInfo=await page.evaluate(()=>({generationMs:scenePlayer.generationMs,entities:scenePlayer.scene.nodes.size,renderCount:scenePlayer.renderer.renderCount,objects:scenePlayer.renderer.objects.length}));
      assert.equal(initialInfo.entities,4);assert.equal(initialInfo.objects,2);
      if(mode==="dom"){assert.equal(await page.locator("canvas").count(),0);assert.equal(await page.locator('.component[data-component="SpriteRenderer"] img').evaluate(e=>getComputedStyle(e).imageRendering),"crisp-edges");}
      else{await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>scenePlayer.renderer.renderCount),initialInfo.renderCount);}
      for(const [id,type] of [["background","ProceduralNoise"],["moon","ProceduralNoise"],["moon","Glow"],["moon","DropShadow"],["camera","Vignette"]]){
        await call("setComponent",id,type,{enabled:false});assert(!initial.equals(await capture(`without_${type}`)));await call("setComponent",id,type,{enabled:true});
      }
      for(const size of [{width:390,height:844},{width:1200,height:360},{width:1280,height:720},{width:677,height:913}]){
        await page.setViewportSize(size);await page.waitForFunction(size=>window.scenePlayer.view.width===size.width&&window.scenePlayer.view.height===size.height,size);await call("whenIdle");
        const view=await page.evaluate(()=>scenePlayer.view);assert(Math.abs(view.worldHeight-Math.max(3.6,6.4/(size.width/size.height)))<1e-8);await capture(`${size.width}x${size.height}`);
      }
      await page.keyboard.press("a");await call("whenIdle");const letterbox=await page.evaluate(()=>scenePlayer.view);assert(Math.abs(letterbox.aspect-16/9)<1e-9);await capture("letterbox");await page.keyboard.press("a");
      await call("setComponent","camera","Camera",{referenceVerticalSize:9});await call("setComponent","background","GaussianBlur",{enabled:false});await call("setComponent","background","ProceduralNoise",{enabled:false});await call("setComponent","camera","Vignette",{enabled:false});await call("setActive","moon",false);
      const clamp=await capture("clamp"),view=await page.evaluate(()=>scenePlayer.view);const clampPixels=checkClamp(clamp,view,fs.readFileSync(path.join(root,"assets/intro_background/background.png")));
      await page.setViewportSize({width:640,height:360});await call("loadScene",origin+sourceURL);
      const next=alternative(origin);await call("loadScene",next,{baseURL:origin+sourceURL});
      assert.equal(await page.evaluate(()=>scenePlayer.scene.nodes.size),7);assert.equal(await page.evaluate(()=>scenePlayer.renderer.objects.length),3);await capture("alternative");
      assert.equal(await page.evaluate(()=>scenePlayer.scene.cameraNode.id),"view-main");
      await call("setCamera","view-alt");assert.equal(await page.evaluate(()=>scenePlayer.scene.cameraNode.id),"view-alt");await capture("alternate_camera");await call("setCamera","view-main");
      await call("setTransform","actors",{localPosition:{x:.7,y:-.2,z:0},localRotation:{x:20,y:15,z:35},localScale:{x:1.3,y:.8,z:1}});await capture("nested_3d");
      if(mode==="babylon"){
        const difference=await page.evaluate(()=>{const p=scenePlayer,node=p.renderer.nodes.get("actor-a");node.computeWorldMatrix(true);const a=node.getWorldMatrix().asArray(),b=p.scene.world.get("actor-a");return Math.max(...a.map((x,i)=>Math.abs(x-b[i])));});assert(difference<1e-5,"Backend transforms must match the shared scene graph");
      }
      await call("setActive","actors",false);
      for(const z of [-20,120]){
        await call("setTransform","small-rect",{localPosition:{z}});const clipped=png(await capture(z<0?"behind_camera":"beyond_far"));
        let max=0;for(let i=0;i<clipped.width*clipped.height;i++)for(let c=0;c<3;c++)max=Math.max(max,clipped.pixels[i*clipped.channels+c]);
        assert.equal(max,0,"The shared camera near/far planes must clip DOM and Babylon objects");
      }
      await call("setTransform","small-rect",{localPosition:{z:-.5}});await call("setActive","actors",true);
      await call("setComponent","actor-a","SpriteRenderer",{color:{a:0}});await capture("transparent_actor");
      await call("addComponent","actor-b",{type:"Glow",color:{r:.2,g:1,b:.5,a:1},sigmaWorld:.07,intensity:.8});assert(await page.evaluate(()=>Boolean(scenePlayer.scene.component("actor-b","Glow"))));
      await call("removeComponent","actor-b","Glow");
      await call("addEntity","actors",{id:"added",components:[{type:"SpriteRenderer",asset:"rect"}],children:[]});assert.equal(await page.evaluate(()=>scenePlayer.scene.nodes.size),8);await call("removeEntity","added");assert.equal(await page.evaluate(()=>scenePlayer.scene.nodes.size),7);
      // Scene validation must fail before replacing the running scene.
      const rejected=await page.evaluate(async()=>{const before=scenePlayer.scene;const data=scenePlayer.exportScene();data.root.children[0].id=data.root.id;try{await scenePlayer.loadScene(data);return false;}catch{return scenePlayer.scene===before;}});assert(rejected);
      await call("reset");assert.equal(await page.evaluate(()=>scenePlayer.scene.nodes.size),7);
      // A non-square noise texture and independent components on renamed entities.
      const tiled=structuredClone(authored);tiled.root.id="stage-x";tiled.assets={tiles:structuredClone(tiled.assets.background)};
      tiled.root.children=tiled.root.children.slice(0,2);tiled.root.children[0].id="lens-x";tiled.root.children[1].id="surface-x";
      tiled.root.children[1].components.find(c=>c.type==="TiledSpriteRenderer").asset="tiles";
      const noise=tiled.root.children[1].components.find(c=>c.type==="ProceduralNoise");noise.textureSize={x:32,y:48};noise.seed=73;
      await call("loadScene",tiled,{baseURL:origin+sourceURL});await capture("renamed_tile");
      assert.equal(await page.evaluate(()=>scenePlayer.renderer.objects.length),1);
      // A small, offset secondary tile must repeat without punching holes in
      // opaque or translucent atlas cells. Alpha is independent of grain RGB.
      const spriteNoise={type:"ProceduralNoise",seed:891,textureSize:{x:8,y:12},worldSize:{x:.16,y:.24},origin:{x:.03,y:-.04},range:.4,bands:[{sigmaTexels:{x:.5,y:.8},variance:.008}]};
      const atlasFixture={schemaVersion:1,assets:{test:{type:"Sprite",file:origin+"/tests/fixtures/rect_sprite.png",size:{x:2,y:3},pixelsPerUnit:1,pivot:{x:.5,y:.5},filter:"point",atlas:{cellSize:{x:1,y:3},columns:2,rows:1,frameCount:2}}},root:{id:"noise-test",children:[
        {id:"camera",transform:{localPosition:{z:-10}},components:[{type:"Camera",referenceVerticalSize:3.6,clearColor:{r:.2,g:.3,b:.4,a:1}}]},
        {id:"sprite",components:[{type:"SpriteRenderer",asset:"test",frame:0},spriteNoise]}
      ]}};
      await call("loadScene",atlasFixture);const sourcePixels=png(fs.readFileSync(path.join(root,"tests/fixtures/rect_sprite.png")));let alphaChecks=0,repeatChecks=0;
      for(const opacity of [1,.4])for(const frame of [0,1]){
        await call("setComponent","sprite","SpriteRenderer",{frame,color:{a:opacity}});const image=png(await capture(`noise_atlas_${frame}_${opacity}`));
        const at=(x,y,c)=>(y*640+x)*image.channels+c;
        for(let row=0;row<3;row++)for(let y=33+row*100;y<106+row*100;y+=5)for(let x=273;x<350;x+=5){
          const sourceAt=(row*2+frame)*4,alpha=sourcePixels.pixels[sourceAt+3]/255*opacity;
          for(let c=0;c<3;c++){
            if(sourcePixels.pixels[sourceAt+c]===0||alpha===0){assert(Math.abs(image.pixels[at(x,y,c)]-Math.round([51,76.5,102][c]*(1-alpha)))<=1,"Secondary texture must preserve sprite alpha and black channels");alphaChecks++;}
            assert(Math.abs(image.pixels[at(x,y,c)]-image.pixels[at(x+16,y,c)])<=1,"Horizontal noise repeat has a seam");
            assert(Math.abs(image.pixels[at(x,y,c)]-image.pixels[at(x,y+24,c)])<=1,"Vertical noise repeat has a seam");repeatChecks+=2;
          }
        }
        if(frame===1&&opacity===1){const levels=new Set();for(let y=235;y<265;y++)for(let x=275;x<305;x++)levels.add(image.pixels[at(x,y,0)]);assert(levels.size>5,"The secondary texture must modulate an opaque white sprite cell");}
      }
      await page.evaluate(mode=>{const object=scenePlayer.renderer.objects.find(o=>o.id==="sprite");window.noiseIdentity=mode==="dom"?object.noiseURL:object.textures.get("noise");},mode);
      await call("setComponent","sprite","ProceduralNoise",{origin:{x:-.23,y:.31},worldSize:{x:.32,y:.48},enabled:false});
      await call("setComponent","sprite","ProceduralNoise",{enabled:true});
      assert(await page.evaluate(mode=>{const object=scenePlayer.renderer.objects.find(o=>o.id==="sprite");return window.noiseIdentity===(mode==="dom"?object.noiseURL:object.textures.get("noise"));},mode),"Live phase, size and enable edits must reuse the generated texture");
      // Rapid scene replacement must settle on the last request without stale jobs.
      await page.evaluate(async({a,b,baseURL})=>{await Promise.all([scenePlayer.loadScene(a,{baseURL}),scenePlayer.loadScene(b,{baseURL})]);await scenePlayer.whenIdle();},{a:next,b:authored,baseURL:origin+sourceURL});
      assert.equal(await page.evaluate(()=>scenePlayer.scene.data.root.id),"intro");await capture("reloaded");
      if(mode==="dom")assert.equal(await page.locator(".scene-world").count(),1);
      assert.deepEqual(errors,[]);
      report[mode]={...initialInfo,referenceDifference:visual,moonNoise,spriteNoise:{alphaChecks,repeatChecks,liveTextureReuse:true},clampPixels,renamedEntities:true,multipleSprites:true,nestedTransforms:true,nonSquareAsset:true,optionalComponents:true,cameraSwitch:true,cameraClipping:true,addRemoveEntities:true,rapidSceneReplacement:true,errors};
      await page.close();
    }
    const second=await browser.newPage({viewport:{width:640,height:360},deviceScaleFactor:2});await second.goto(`${origin}/index.html?scene=${sourceURL}&renderer=babylon`);await second.waitForFunction(()=>window.scenePlayer?.ready);assert.deepEqual(await second.evaluate(()=>[scenePlayer.renderer.engine.getRenderWidth(),scenePlayer.renderer.engine.getRenderHeight()]),[1280,720]);await second.close();
    if(output)fs.writeFileSync(path.join(output,"browser_check.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
