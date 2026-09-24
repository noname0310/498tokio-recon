const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{compare}=require('./pixel-check.cjs');
async function main(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tokio-standalone-')),portable=path.join(directory,'player.html'),html=fs.readFileSync(path.join(root,'dist/standalone/index.html'));
 fs.writeFileSync(portable,html);assert.deepEqual(fs.readdirSync(path.join(root,'dist/standalone')),['index.html']);
 assert(html.includes(Buffer.from(fs.readFileSync(path.join(root,'assets/soundtrack.m4a')).toString('base64'))),'Audio bytes are embedded unchanged');
 const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [name,type]of [['chromium',chromium],['firefox',firefox]]){
  const browser=await type.launch({headless:true});
  try{
   const file=await browser.newPage({viewport:{width:640,height:360}}),network=[],errors=[];
   file.on('pageerror',e=>errors.push(e.message));file.on('request',r=>{if(!r.url().startsWith('data:')&&!r.url().startsWith('blob:')&&!r.url().startsWith(pathToFileURL(portable).href))network.push(r.url());});
   await file.route(/^https?:/,r=>r.abort());
   await file.goto(pathToFileURL(portable).href+'?controls=0');await file.waitForFunction(()=>window.scenePlayer?.ready);await file.evaluate(()=>scenePlayer.whenIdle());
   const normal=await browser.newPage({viewport:{width:640,height:360}});await normal.goto(`${base}/?renderer=babylon&controls=0`);await normal.waitForFunction(()=>window.scenePlayer?.ready);await normal.evaluate(()=>scenePlayer.whenIdle());
   for(const frame of [15,173,540,900,1150,1500,1943,2200,2225,2245]){
    for(const page of [file,normal])await page.evaluate(async frame=>{await scenePlayer.seekFrame(frame,{numerator:30,denominator:1});await scenePlayer.whenIdle();},frame);
    const diff=compare(await file.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}),await normal.screenshot({style:".runtime-loading-status { visibility: hidden !important; }"}));assert(diff.max<=2&&diff.mae<.001,`${name} frame ${frame}: ${JSON.stringify(diff)}`);
   }
   await file.evaluate(async()=>{await scenePlayer.seekFrame(360,{numerator:30,denominator:1});await scenePlayer.play();});await file.waitForFunction(()=>scenePlayer.time>12.15);await file.evaluate(()=>scenePlayer.pause());
   assert(await file.evaluate(()=>scenePlayer.audioPlayer.element.src.startsWith('data:audio/mp4;base64,')));
   assert.deepEqual(network,[],'Portable HTML must not request companion files or network resources');assert.deepEqual(errors,[]);
   const unsupported=await browser.newPage(),unsupportedErrors=[];
   unsupported.on('pageerror',error=>unsupportedErrors.push(error.message));
   await unsupported.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/i.test(kind)?null:original.call(this,kind,...args);};
   });
   await unsupported.goto(pathToFileURL(portable).href);
   await unsupported.waitForFunction(()=>document.getElementById('status')?.getAttribute('role')==='alert');
   assert.match(await unsupported.locator('#status').innerText(),/WebGL/i);
   assert.equal(await unsupported.locator('#status').isVisible(),true);
   assert.equal(await unsupported.locator('canvas').count(),0,'Failed construction must remove the viewport canvas');
   assert.equal(await unsupported.evaluate(()=>Boolean(window.scenePlayer)),false);
   assert.deepEqual(unsupportedErrors,[],'Renderer construction failure must be caught');
   await unsupported.close();
   console.log(`${name}: offline file://, embedded audio playback, worker, seeks and identical Babylon frames passed (${html.length} bytes).`);
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));fs.unlinkSync(portable);fs.rmdirSync(directory);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
