const assert=require('node:assert/strict'),http=require('node:http'),{chromium,firefox}=require('playwright');
const {makeServer}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');
const fixture={schemaVersion:1,name:'Progressive scene',timeline:{duration:5},assets:{
  sound:{type:'Audio',file:'/waiting.m4a'},future:{type:'Sprite',file:'/waiting.png',size:{x:2,y:3},pixelsPerUnit:4},fast:{type:'Sprite',file:'/tests/fixtures/rect_sprite.png',size:{x:2,y:3},pixelsPerUnit:20}
},root:{id:'root',children:[
  {id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera',referenceVerticalSize:3.6}]},
  {id:'playback',components:[{type:'AudioPlayer',asset:'sound'},{type:'AnimationPlayer',sequence:'main',clock:{entity:'playback',component:'AudioPlayer'}},{type:'PlayerControls',player:{entity:'playback',component:'AnimationPlayer'}}]},
  {id:'visible',components:[{type:'PlaneRenderer',size:{x:2,y:2},color:{r:0,g:1,b:0,a:1}}]},
  {id:'spark',transform:{localPosition:{x:-1,y:.8,z:-1},localScale:{x:4,y:4,z:1}},components:[{type:'SpriteRenderer',asset:'fast'},{type:'Glow',sigmaWorld:.03,color:{r:1,g:0,b:0,a:1},intensity:4}]},
  {id:'noise',transform:{localPosition:{x:10}},components:[{type:'PlaneRenderer'},{type:'ProceduralNoise',seed:3,textureSize:{x:16,y:16},bands:[{sigmaTexels:{x:1,y:1},variance:.01}]}]}
]},animation:{master:'main',tracks:{},sequences:{main:{tickResolution:{numerator:30,denominator:1},displayRate:{numerator:30,denominator:1},playbackRange:{start:0,end:150}}}},reconstruction:{padding:'x'.repeat(64000)}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function check(type,renderer){
 const gates={json:deferred(),audio:deferred(),image:deferred(),cancel:deferred()},files=makeServer(),serve=files.listeners('request')[0];
 const body=Buffer.from(JSON.stringify(fixture)),closed=deferred();let cancelled=false;
 const server=http.createServer((request,response)=>{
  if(request.url==='/slow.scene.json'||request.url==='/cancel.scene.json'){
    response.writeHead(200,{'Content-Type':'application/json','Content-Length':body.length,'Cache-Control':'no-store'});
    response.write(body.subarray(0,Math.floor(body.length/2)));
    const gate=request.url==='/slow.scene.json'?gates.json:gates.cancel;
    if(request.url==='/cancel.scene.json')response.on('close',()=>{if(!response.writableEnded)cancelled=true;closed.resolve();});
    void gate.promise.then(()=>{if(!response.destroyed)response.end(body.subarray(Math.floor(body.length/2)));});return;
  }
  if(request.url==='/waiting.m4a'){void gates.audio.promise.then(()=>{request.url='/assets/soundtrack.m4a';serve(request,response);});return;}
  if(request.url==='/waiting.png'){void gates.image.promise.then(()=>{request.url='/tests/fixtures/rect_sprite.png';serve(request,response);});return;}
  if(request.url==='/invalid.scene.json'){response.writeHead(200,{'Content-Type':'application/json'});response.end('not json');return;}
  serve(request,response);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,browser=await type.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const Original=Worker,queue=[];let hold=true;window.Worker=class extends Original{postMessage(...args){if(hold)queue.push(()=>super.postMessage(...args));else super.postMessage(...args);}};
    window.releaseTextures=()=>{hold=false;for(const send of queue.splice(0))send();};
  });
  await page.goto(`${base}/?scene=/slow.scene.json&renderer=${renderer}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>/\((?:49|50)%\)/.test(document.querySelector('[data-state="active"][data-stage="Scene"]')?.textContent||''));
  assert.equal(await page.locator('#status').isVisible(),false);
  assert.equal(await page.locator('.player-controls').count(),0,'Scene declarations are not available until JSON completes');
  gates.json.resolve();await page.waitForFunction(()=>document.querySelector('audio')&&document.querySelector('[data-state="active"][data-stage="Images"]'));
  assert.equal(await page.evaluate(()=>Boolean(window.scenePlayer)),false,'Startup waits for the audio clock metadata');
  assert.equal(await page.locator('.player-controls').count(),0,'Controls require the actual media duration');
  assert.deepEqual(await page.evaluate(()=>{const audio=document.querySelector('audio');return {ready:audio.readyState,paused:audio.paused,preload:audio.preload};}),{ready:0,paused:true,preload:'metadata'});
  gates.audio.resolve();await page.waitForFunction(()=>window.scenePlayer?.ready||document.querySelector('#status[role="alert"]'));
  assert.equal(await page.locator('#status[role="alert"]').count(),0,await page.locator('#status').textContent());
  assert.equal(await page.locator('.player-controls').isVisible(),true,'Metadata makes controls ready without waiting for images or procedural jobs');
  assert.deepEqual(await page.evaluate(()=>({metadata:scenePlayer.audioPlayer.element.readyState>=HTMLMediaElement.HAVE_METADATA,mediaDuration:scenePlayer.duration===scenePlayer.audioPlayer.element.duration,complete:scenePlayer.loadingProgress.isComplete})),{metadata:true,mediaDuration:true,complete:false});
  assert(await page.evaluate(()=>scenePlayer.duration>200),'Controls use the media duration, not the authored five-second timeline');
  // Visible geometry must not wait for the unrelated procedural job either.
  await page.waitForFunction(()=>scenePlayer.resources.isImageReady('fast'));
  await page.waitForFunction(()=>scenePlayer.renderer.kind==='dom'||scenePlayer.renderer.renderCount>0);
  await page.evaluate(()=>scenePlayer.renderer.kind==='babylon'?scenePlayer.renderer.scene.whenReadyAsync():undefined);
  const capture=png(await page.screenshot({style:'.runtime-loading-status,.player-controls { visibility:hidden !important; }'}));
  const center=(180*capture.width+320)*capture.channels;
  assert(capture.pixels[center+1]>240,'The prepared green plane must render before pending assets');
  await page.locator('[data-action="play"]').click();await page.waitForFunction(()=>scenePlayer.time>.1);await page.evaluate(()=>scenePlayer.pause());
  assert.equal(await page.locator('.player-feedback').isVisible(),false);
  gates.image.resolve();await page.evaluate(()=>window.releaseTextures());await page.evaluate(()=>scenePlayer.whenIdle());
  assert.equal(await page.locator('.runtime-loading-status').isVisible(),false);
  await page.evaluate(()=>{window.oldLoad=scenePlayer.loadScene('/cancel.scene.json');});
  await page.waitForFunction(()=>/\((?:49|50)%\)/.test(document.querySelector('[data-state="active"][data-stage="Scene"]')?.textContent||''));
  await page.evaluate(async()=>{const data={schemaVersion:1,assets:{},root:{id:'new',children:[{id:'camera',components:[{type:'Camera'}]}]}};await scenePlayer.loadScene(data);await window.oldLoad;await scenePlayer.whenIdle();});
  let timeout;try{await Promise.race([closed.promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Cancelled HTTP connection stayed open')),2000);})]);}finally{clearTimeout(timeout);}
  assert.equal(cancelled,true,'Replacing a scene cancels its pending HTTP download');
  const bad=await page.evaluate(()=>scenePlayer.loadScene('/invalid.scene.json').then(()=>'',error=>error.message));assert.match(bad,/parse scene JSON/);
  assert.equal(await page.evaluate(()=>scenePlayer.scene.data.root.id),'new','Invalid JSON retains the current scene');
  assert.deepEqual(errors,[]);
  console.log(`${type.name()}-${renderer}: XHR progress, metadata-gated startup, progressive geometry, media duration and cancelled downloads passed.`);
 }finally{Object.values(gates).forEach(gate=>gate.resolve());await browser.close();await new Promise(r=>server.close(r));}
}
(async()=>{for(const [type,renderer]of [[chromium,'dom'],[chromium,'babylon'],[firefox,'dom']])await check(type,renderer);})().catch(error=>{console.error(error);process.exitCode=1;});
