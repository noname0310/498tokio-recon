const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{pathToFileURL}=require("node:url");
const {chromium,firefox}=require("playwright"),{makeServer,root}=require("./serve.cjs");
const soundtrack=path.join(root,"assets/soundtrack.mp3");
async function clocks(){
  const {PerformanceClock,Frame,Time,frameRate,Scene}=await import(pathToFileURL(path.join(root,"dist/runtime/player.js")));
  const rate=frameRate(30000,1001);let now=0;
  const clock=new PerformanceClock(Time.fromFrame(Frame.from(10)),rate,true,()=>now);
  await clock.seek(Time.fromRatio(19n,2n),rate);assert.equal(Time.key(clock.sample(rate)),"9:1/2");
  await clock.play();now=1001/30;assert.equal(Time.key(clock.sample(rate)),"0:50051/100100");
  // Microsecond sampling has bounded quantization; exact seeks are not rounded.
  clock.pause();await clock.seek(Time.fromFrame(Frame.from(2147483000)),frameRate(24000));
  assert.equal(clock.sample(frameRate(24000)).frame,2147483000);clock.dispose();
  const heldClock=new PerformanceClock(Time.fromFrame(Frame.from(120)),frameRate(1),false,()=>now);
  await heldClock.seek(Time.fromRatio(1703n,2n),rate);await heldClock.play();now+=16;
  const displayed=heldClock.sample(rate);heldClock.pauseOffsetHint=Time.convert(displayed,rate,frameRate(1));
  now+=10;heldClock.sample(rate);heldClock.pause();
  assert.equal(Time.compare(heldClock.sample(rate),displayed),0,"Performance pause retains the evaluated pose despite later clock samples");
  await heldClock.seek(Time.fromFrame(Frame.from(60)),rate);await heldClock.play();heldClock.pause();
  assert.equal(Time.key(heldClock.sample(rate)),"60:0/1","A seek invalidates an older pause hint");heldClock.dispose();
  const data=JSON.parse(fs.readFileSync(path.join(root,"assets/final_animation.scene.json")));
  const scene=new Scene(data,pathToFileURL(path.join(root,"assets/final_animation.scene.json")).href);
  assert.equal(scene.animationPlayer.clock.entity,"playback");assert.equal(scene.asset("moon").type,"Sprite");assert.equal(scene.audioAsset("soundtrack").type,"Audio");assert.throws(()=>scene.asset("soundtrack"));
  assert.equal(scene.requireComponent("playback","PlayerControls").player.entity,"playback");assert.equal(scene.requireComponent("playback","AudioPlayer").preservesPitch,false);
  const bad=structuredClone(data);bad.root.children.find(n=>n.id==="playback").components.find(c=>c.type==="AnimationPlayer").clock.entity="missing";assert.throws(()=>new Scene(bad,"http://localhost/"));
  const badControls=structuredClone(data);badControls.root.children.find(n=>n.id==="playback").components.find(c=>c.type==="PlayerControls").player.entity="missing";assert.throws(()=>new Scene(badControls,"http://localhost/"));
  console.log("Clocks: rational looping, exact large frame seek and component/asset reference validation passed.");
}
async function rangeChecks(origin){
  const url=origin+"/assets/soundtrack.mp3",bytes=fs.readFileSync(soundtrack),head=await fetch(url,{method:"HEAD"});
  assert.equal(head.status,200);assert.equal(head.headers.get("content-type"),"audio/mpeg");assert.equal(Number(head.headers.get("content-length")),bytes.length);assert.equal(head.headers.get("accept-ranges"),"bytes");
  for(const [header,start,end] of [["bytes=100-199",100,199],["bytes=-100",bytes.length-100,bytes.length-1],[`bytes=${bytes.length-100}-`,bytes.length-100,bytes.length-1]]){
    const response=await fetch(url,{headers:{Range:header}});assert.equal(response.status,206);assert.equal(response.headers.get("content-range"),`bytes ${start}-${end}/${bytes.length}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(start,end+1));
  }
  for(const range of ["bytes=-0",`bytes=${bytes.length}-`,"bytes=50-10","bytes=x-y","bytes=0-1,4-5"]){const response=await fetch(url,{headers:{Range:range}});assert.equal(response.status,416);await response.arrayBuffer();}
  console.log("Audio HTTP: MP3 MIME, HEAD, exact byte ranges, suffix ranges and invalid range handling passed.");
}
async function buttonChecks(page){
  await page.evaluate(()=>scenePlayer.pause());
  await page.mouse.click(200,120);assert.equal(await page.evaluate(()=>scenePlayer.playing),false,"Surface clicks cannot start playback");
  await page.evaluate(()=>{window.playIcon=document.querySelector('[data-action="play"] path');});
  for(const expected of [true,false,true,false]){
    const bounds=await page.locator('[data-action="play"]').boundingBox();
    // Hold across multiple animation ticks, directly over the icon.
    await page.mouse.click(bounds.x+17,bounds.y+20,{delay:90});
    await page.waitForFunction(expected=>scenePlayer.playing===expected,expected);
    assert.equal(await page.evaluate(()=>window.playIcon===document.querySelector('[data-action="play"] path')),true,"State changes must retain the icon node");
  }
  await page.locator('[data-action="play"]').click();await page.waitForFunction(()=>scenePlayer.playing);
  await page.mouse.click(200,120);assert.equal(await page.evaluate(()=>scenePlayer.playing),true,"Surface clicks cannot pause playback");
  await page.evaluate(()=>scenePlayer.pause());
}
async function observeUI(page){
  await page.evaluate(()=>{
    window.uiStats={mutations:0,buttonMutations:0,progressWrites:0,stateEvents:0};
    window.stopStateObserver=scenePlayer.onStateChange(()=>window.uiStats.stateEvents++);
    const root=document.querySelector('.player-controls');
    window.uiObserver=new MutationObserver(records=>{for(const record of records){
      window.uiStats.mutations++;
      if(record.target instanceof Element&&record.target.closest('.player-toolbar button:not(.player-time)'))window.uiStats.buttonMutations++;
      if(record.target===document.querySelector('.player-timeline')&&record.attributeName==='style')window.uiStats.progressWrites++;
    }});window.uiObserver.observe(root,{subtree:true,attributes:true,childList:true,characterData:true});
  });
}
async function stopObservingUI(page){return page.evaluate(()=>{window.uiObserver.disconnect();window.stopStateObserver();return window.uiStats;});}
async function pauseChecks(page,label){
  const settled=await page.evaluate(async()=>{
    const {Time,frameRate}=await import('/runtime/player.js'),time=Time.fromDecimal(16.133483000000002);
    scenePlayer.pause();await scenePlayer.seekFrame(time,frameRate(1));
    return {expected:Time.key(time),actual:Time.key(scenePlayer.scene.timelineTime)};
  });
  assert.equal(settled.actual,settled.expected,`${label}: asynchronous decoder settlement preserves the exact requested subframe`);
  const modes=["engine","native"];
  if(await page.evaluate(()=>Boolean(window.mediaActions?.get("pause"))))modes.push("session");
  for(const mode of modes){
    await page.evaluate(async()=>{scenePlayer.pause();scenePlayer.setPlaybackRate(1);await scenePlayer.seek(16);await scenePlayer.play();});
    await page.waitForFunction(()=>scenePlayer.time>16.12);
    const before=await page.evaluate(async mode=>{
      const {Time}=await import('/runtime/player.js'),engine=scenePlayer;
      const time=engine.time,key=Time.key(engine.scene.timelineTime),signature=engine.scene.animationSignature();
      if(mode==="engine")engine.pause();else if(mode==="native")engine.audioPlayer.element.pause();else window.mediaActions.get("pause")({action:"pause"});
      // A getter can run before the browser's queued timeupdate/pause events.
      const clockTime=engine.clock.currentTime;
      return {time,key,signature,clockTime};
    },mode);
    await page.waitForFunction(()=>!scenePlayer.playing&&!scenePlayer.audioPlayer.seeking);
    await page.waitForTimeout(100);await page.evaluate(()=>scenePlayer.whenIdle());
    const after=await page.evaluate(async()=>{
      const {Time}=await import('/runtime/player.js');
      return {time:scenePlayer.time,key:Time.key(scenePlayer.scene.timelineTime),signature:scenePlayer.scene.animationSignature(),audio:scenePlayer.audioPlayer.element.currentTime};
    });
    assert.equal(before.clockTime,before.time,`${label} ${mode}: a getter before pause events preserves the displayed offset`);
    assert.equal(after.key,before.key,`${label} ${mode}: pause preserves the exact evaluated subframe`);
    assert.equal(after.signature,before.signature,`${label} ${mode}: pause keeps the rendered pose`);
    assert(Math.abs(after.audio-before.time)<.005,`${label} ${mode}: audio aligns to the displayed offset`);
    await page.evaluate(()=>scenePlayer.play());await page.waitForFunction(time=>scenePlayer.time>time+.08,before.time);
  }
  await page.evaluate(async()=>{
    const {Frame}=await import('/runtime/player.js');
    scenePlayer.audioPlayer.element.pause();await scenePlayer.seekFrame(Frame.from(2236));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(async()=>{const {Time,frameRate}=await import('/runtime/player.js');return Time.key(Time.convert(scenePlayer.scene.timelineTime,frameRate(1),frameRate(30)));}),"2236:0/1",`${label}: a new exact seek supersedes queued native pause events`);
  assert(await page.evaluate(()=>scenePlayer.scene.isActive('helmet-launch-hull')),`${label}: the requested keyframe boundary is evaluated`);
  await page.evaluate(()=>scenePlayer.seek(0));
  console.log(`${label}: engine/native/available Media Session pause preserve the evaluated subframe and pose; audio alignment, resume and queued seek precedence passed.`);
}
async function browserChecks(origin){
  const executablePath=[chromium.executablePath()].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,executablePath});
  try{for(const renderer of ["dom","babylon"]){
    const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[];
    page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
    await page.addInitScript(()=>{
      window.mediaActions=new Map();if("mediaSession" in navigator){const original=navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);navigator.mediaSession.setActionHandler=(name,handler)=>{window.mediaActions.set(name,handler);original(name,handler);};}
    });
    if(renderer==="dom")await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>{throw new Error("Canvas forbidden");};});
    await page.goto(`${origin}/index.html?renderer=${renderer}`);await page.waitForFunction(()=>window.scenePlayer?.ready);
    await page.evaluate(()=>scenePlayer.setComponent("playback","PlayerControls",{hideDelayMs:120}));
    assert.equal(await page.evaluate(()=>scenePlayer.clock.kind),"audio");assert.equal(await page.locator('audio[data-component="AudioPlayer"]').count(),1);
    assert.equal(await page.evaluate(()=>scenePlayer.audioPlayer.element.preservesPitch),false);
    assert.equal(await page.locator('.player-controls[data-entity="playback"][data-component="PlayerControls"]').count(),1);
    assert.equal(await page.evaluate(()=>scenePlayer.playerControls.element.parentElement===document.body),true);
    await buttonChecks(page);
    await pauseChecks(page,`Chromium ${renderer}`);
    const duration=await page.evaluate(()=>scenePlayer.duration);assert(duration>230&&duration<230.1,"Gapless decoded duration matches AAC source, not padded MP3 container");
    const controls=page.locator(".player-controls"),bar=await controls.boundingBox();
    await page.locator('[data-action="play"]').click();await page.mouse.move(480,200);await page.waitForFunction(()=>scenePlayer.time>.15);
    await page.waitForFunction(()=>document.querySelector(".player-controls").dataset.visible==="false");await page.waitForTimeout(200);
    assert.equal(await controls.evaluate(e=>getComputedStyle(e).opacity),"0");assert.equal(await controls.evaluate(e=>getComputedStyle(e).transform),"none");assert.deepEqual(await controls.boundingBox(),bar);
    assert.equal(await controls.evaluate(e=>e.inert),true);
    await controls.dispatchEvent("pointerenter");assert.equal(await controls.getAttribute("data-visible"),"false","Invisible toolbar hover cannot reveal controls");
    await observeUI(page);const hiddenStart=await page.evaluate(()=>scenePlayer.time);await page.waitForTimeout(550);const hiddenStats=await stopObservingUI(page);
    assert.equal(hiddenStats.mutations,0,"Hidden controls must perform zero DOM writes");assert.equal(hiddenStats.stateEvents,0,"Animation ticks cannot drive state observers");assert(await page.evaluate(()=>scenePlayer.time)>hiddenStart);
    await page.mouse.move(36,510);await page.waitForTimeout(200);await observeUI(page);await page.waitForTimeout(550);const visibleStats=await stopObservingUI(page);
    assert.equal(visibleStats.buttonMutations,0,"Playback cannot rewrite toolbar buttons");assert(visibleStats.progressWrites>0&&visibleStats.progressWrites<=7,JSON.stringify(visibleStats));assert.equal(visibleStats.stateEvents,0);
    const hintStart=await page.evaluate(()=>{const audio=scenePlayer.audioPlayer.element,time=audio.currentTime;Object.defineProperty(audio,"currentTime",{configurable:true,get:()=>time});return scenePlayer.time;});
    await page.waitForTimeout(150);assert(await page.evaluate(()=>scenePlayer.time)>hintStart+.08,"Coarse media timestamps must not freeze animation during playback");
    await page.evaluate(()=>{const audio=scenePlayer.audioPlayer.element;delete audio.currentTime;audio.pause();});
    await page.waitForFunction(()=>!scenePlayer.playing);assert.equal(await controls.getAttribute("data-visible"),"true");
    await page.evaluate(()=>{scenePlayer.audioPlayer.element.currentTime=1.85;});await page.waitForFunction(()=>Math.abs(scenePlayer.time-1.85)<.001&&!scenePlayer.audioPlayer.seeking);
    const time=await page.evaluate(()=>scenePlayer.time);await page.waitForTimeout(170);assert.equal(await page.evaluate(()=>scenePlayer.time),time);
    assert.equal(await page.locator('.player-timeline').inputValue(),"55","At native time 1.85 seconds, the evaluated 30 fps frame is 55, not the rounded frame 56");
    assert.equal(await page.evaluate(()=>[...scenePlayer.scene.nodes.keys()].filter(id=>id.startsWith("__sequence__")).length),3);
    await page.evaluate(()=>Promise.all([scenePlayer.seek(.1),scenePlayer.seek(1.1)]));assert.equal(await page.evaluate(()=>scenePlayer.time),1.1);
    await page.evaluate(async()=>{const {Frame}=await import('/runtime/player.js');await scenePlayer.seekFrame(Frame.from(850));});
    await page.getByRole('button',{name:'Next frame (.)',exact:true}).click();await page.waitForFunction(()=>!scenePlayer.audioPlayer.seeking);await page.evaluate(()=>scenePlayer.whenIdle());
    assert.equal(await page.locator('.player-timeline').inputValue(),"851");
    assert.equal(await page.evaluate(()=>scenePlayer.scene.isActive('forward-scene')),true,"Stepping to frame 851 applies the hard cut immediately");
    assert.equal(await page.evaluate(()=>scenePlayer.scene.component('starfield-wipe','SpriteRenderer').frame),4,"Stepping to frame 851 also changes the wipe atlas pose");
    await page.getByRole('button',{name:'Previous frame (,)',exact:true}).click();await page.waitForFunction(()=>!scenePlayer.audioPlayer.seeking);await page.evaluate(()=>scenePlayer.whenIdle());
    assert.equal(await page.locator('.player-timeline').inputValue(),"850");assert.equal(await page.evaluate(()=>scenePlayer.scene.isActive('forward-scene')),false);
    await page.evaluate(()=>{const a=scenePlayer.audioPlayer.element;a.volume=.33;a.muted=true;a.playbackRate=1.5;});
    await page.waitForFunction(()=>document.querySelector('[data-action="speed"]').textContent==="1.5×");assert.equal(await page.locator('[data-action="mute"]').getAttribute("aria-label"),"Unmute (M)");
    await page.locator('[data-action="speed"]').click();const speedSlider=page.getByRole('slider',{name:'Playback speed',exact:true});assert.equal(await speedSlider.inputValue(),"1.5");
    await speedSlider.evaluate(slider=>{slider.value="1.37";slider.dispatchEvent(new Event("input",{bubbles:true}));});
    assert.equal(await page.evaluate(()=>scenePlayer.playbackRate),1.37);assert.equal(await page.evaluate(()=>scenePlayer.audioPlayer.element.preservesPitch),false);
    await speedSlider.focus();await page.keyboard.press("ArrowUp");assert.equal(await page.evaluate(()=>scenePlayer.playbackRate),1.38,"The native slider owns arrow keys");
    await page.keyboard.press("Home");assert.equal(await page.evaluate(()=>scenePlayer.playbackRate),.25);await page.keyboard.press("End");assert.equal(await page.evaluate(()=>scenePlayer.playbackRate),2);
    await page.locator('.player-speed-presets [data-speed="1.5"]').click();assert.equal(await page.evaluate(()=>scenePlayer.playbackRate),1.5);assert.equal(await page.locator('.player-speed-menu').isVisible(),false);
    await page.evaluate(()=>scenePlayer.stop());await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>scenePlayer.scene.animationEnabled),false);
    await page.evaluate(()=>{scenePlayer.audioPlayer.element.currentTime=1.85;});await page.waitForFunction(()=>scenePlayer.scene.animationEnabled&&scenePlayer.time===1.85);
    // Media Session handlers act on Audio and are observed by animation/UI.
    if(await page.evaluate(()=>Boolean(window.mediaActions.get("seekto")))){
      await page.evaluate(()=>window.mediaActions.get("seekto")({action:"seekto",seekTime:2}));await page.waitForFunction(()=>scenePlayer.time===2);
      await page.evaluate(()=>window.mediaActions.get("play")({action:"play"}));await page.waitForFunction(()=>scenePlayer.playing);
      await page.evaluate(()=>window.mediaActions.get("pause")({action:"pause"}));await page.waitForFunction(()=>!scenePlayer.playing);
    }
    await page.locator('[data-action="speed"]').click();await page.evaluate(()=>scenePlayer.play());await page.mouse.move(480,200);await page.waitForTimeout(350);
    assert.equal(await controls.getAttribute("data-visible"),"true","An open menu keeps controls visible");await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");await page.locator(".player-timeline").focus();await page.waitForTimeout(350);assert.equal(await controls.getAttribute("data-visible"),"true","Keyboard focus keeps controls visible");
    await page.evaluate(()=>scenePlayer.pause());await page.locator(".player-timeline").focus();const before=await page.locator(".player-timeline").inputValue();await page.keyboard.press("ArrowRight");await page.waitForFunction(()=>!scenePlayer.audioPlayer.seeking);assert(Number(await page.locator(".player-timeline").inputValue())>=Number(before));assert.equal(await page.evaluate(()=>scenePlayer.playing),false);
    // Dragging a paused timeline stays paused; dragging a playing one resumes.
    await page.mouse.move(480,200);await page.evaluate(()=>scenePlayer.seek(0));let bounds=await page.locator(".player-timeline").boundingBox();
    await page.mouse.move(bounds.x+bounds.width*.1,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.2,bounds.y+bounds.height/2);await page.mouse.up();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>scenePlayer.playing),false);
    await page.evaluate(()=>scenePlayer.play());await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.3,bounds.y+bounds.height/2);await page.mouse.up();await page.waitForFunction(()=>scenePlayer.playing);
    await page.evaluate(()=>scenePlayer.pause());await page.keyboard.press("a");assert.equal(await page.locator("#viewport").getAttribute("data-aspect"),"reference");await page.keyboard.press("a");
    await page.setViewportSize({width:375,height:700});await page.mouse.move(100,100);assert(await controls.evaluate(e=>e.scrollWidth<=e.clientWidth));
    const chrome=page.locator('.player-chrome'),adaptiveUI=await chrome.boundingBox();await page.evaluate(()=>scenePlayer.setReferenceAspect(true));
    const letterbox=await page.locator('#viewport').boundingBox();assert(letterbox.height<300);assert.deepEqual(await chrome.boundingBox(),adaptiveUI,"Letterboxing cannot shrink or move screen UI");
    const playBounds=await page.locator('[data-action="play"]').boundingBox();assert(playBounds.y>letterbox.y+letterbox.height,"The play button belongs to the screen, outside the letterboxed scene");
    await page.mouse.click(playBounds.x+17,playBounds.y+20,{delay:90});await page.waitForFunction(()=>scenePlayer.playing);await page.mouse.click(playBounds.x+17,playBounds.y+20,{delay:90});await page.waitForFunction(()=>!scenePlayer.playing);
    await page.locator('[data-action="speed"]').click();const menuBounds=await page.locator('.player-speed-menu').boundingBox();assert(menuBounds.y>=0&&menuBounds.y+menuBounds.height<=700);assert(await speedSlider.isVisible());await page.keyboard.press("Escape");
    const clockBefore=await page.evaluate(()=>{window.controlsClock=scenePlayer.clock;return scenePlayer.time;});
    await page.evaluate(()=>scenePlayer.setComponent("playback","PlayerControls",{enabled:false}));assert.equal(await controls.count(),0);
    await page.evaluate(()=>scenePlayer.setComponent("playback","PlayerControls",{enabled:true}));assert.equal(await controls.count(),1);assert.equal(await page.evaluate(()=>scenePlayer.clock===window.controlsClock),true);assert.equal(await page.evaluate(()=>scenePlayer.time),clockBefore);
    await page.evaluate(async()=>{
      const camera=structuredClone(scenePlayer.scene.cameraNode);camera.id="controls-test-camera";camera.children=[];
      await scenePlayer.addEntity(scenePlayer.scene.data.root.id,camera);await scenePlayer.play();
      window.controlsClock=scenePlayer.clock;window.controlsInstance=scenePlayer.playerControls;
      await scenePlayer.setCamera(camera.id);
    });
    assert.equal(await page.evaluate(()=>scenePlayer.playing&&scenePlayer.clock===window.controlsClock&&scenePlayer.playerControls===window.controlsInstance),true,"Camera changes must retain the clock, playback and screen controls");
    await page.evaluate(()=>scenePlayer.loadScene("/assets/animation_demo/demo.scene.json"));await page.evaluate(()=>scenePlayer.pause());assert.equal(await page.evaluate(()=>scenePlayer.clock.kind),"performance");assert.equal(await page.locator("audio").count(),0);assert.equal(await page.locator('[data-action="mute"]').isVisible(),false);
    await page.setViewportSize({width:960,height:540});await buttonChecks(page);
    await page.evaluate(()=>scenePlayer.dispose());assert.equal(await controls.count(),0);assert.deepEqual(errors,[]);await page.close();
    console.log(`Player ${renderer}: native clock/pitch, reliable icon clicks, surface isolation, speed slider/presets, global UI/component lifecycle, letterboxing, keyboard/scrubbing passed. UI mutations: hidden=${hiddenStats.mutations}, visible progress=${visibleStats.progressWrites}/550 ms, button rewrites=${visibleStats.buttonMutations}.`);
  }
    const touch=await browser.newPage({viewport:{width:375,height:700},hasTouch:true,isMobile:true});
    await touch.goto(`${origin}/index.html?renderer=dom`);await touch.waitForFunction(()=>window.scenePlayer?.ready);
    await touch.evaluate(async()=>{await scenePlayer.setComponent("playback","PlayerControls",{hideDelayMs:120});await scenePlayer.setReferenceAspect(true);});
    await touch.touchscreen.tap(188,350);await touch.touchscreen.tap(188,350);assert.equal(await touch.evaluate(()=>scenePlayer.playing),false);
    await touch.locator('[data-action="play"]').tap();await touch.waitForFunction(()=>scenePlayer.playing);
    await touch.touchscreen.tap(188,350);assert.equal(await touch.evaluate(()=>scenePlayer.playing),true);
    await touch.waitForFunction(()=>document.querySelector('.player-controls').dataset.visible==="false");
    await touch.touchscreen.tap(188,600);assert.equal(await touch.locator('.player-controls').getAttribute('data-visible'),"true","Touching a letterbox bar reveals screen controls without pausing");
    assert.equal(await touch.evaluate(()=>scenePlayer.playing),true);await touch.locator('[data-action="play"]').tap();await touch.waitForFunction(()=>!scenePlayer.playing);
    await touch.locator('[data-action="speed"]').tap();assert(await touch.getByRole('slider',{name:'Playback speed',exact:true}).isVisible());
    fs.mkdirSync(path.join(root,"test-results/animation_runtime"),{recursive:true});await touch.screenshot({style:".runtime-loading-status { visibility: hidden !important; }",path:path.join(root,"test-results/animation_runtime/dom-player.png")});await touch.close();
    console.log("Touch: scene taps preserve playback; letterbox taps reveal controls; play/pause and speed controls remain usable outside the scene.");
  }finally{await browser.close();}
  const firefoxBrowser=await firefox.launch({headless:true});
  try{
    const page=await firefoxBrowser.newPage({viewport:{width:640,height:360}}),errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.mediaActions=new Map();if("mediaSession" in navigator){const original=navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);navigator.mediaSession.setActionHandler=(name,handler)=>{window.mediaActions.set(name,handler);original(name,handler);};}
    });
    await page.goto(`${origin}/index.html?renderer=dom&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
    await pauseChecks(page,"Firefox DOM");assert.deepEqual(errors,[]);
  }finally{await firefoxBrowser.close();}
}
(async()=>{await clocks();await require("./check-audio-clock.cjs").main();const server=makeServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));try{const origin=`http://127.0.0.1:${server.address().port}`;await rangeChecks(origin);await browserChecks(origin);}finally{await new Promise(r=>server.close(r));}})().catch(error=>{console.error(error);process.exitCode=1;});
