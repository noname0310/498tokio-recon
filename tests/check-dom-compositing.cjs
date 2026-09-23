const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');

function greenFraction(buffer){
 const image=png(buffer);let green=0;
 for(let i=0;i<image.pixels.length;i+=image.channels){const r=image.pixels[i],g=image.pixels[i+1],b=image.pixels[i+2];if(g>30&&g>r*1.2&&g>b*1.2)green++;}
 return green/(image.width*image.height);
}

async function check(browser,base,label,size){
 const page=await browser.newPage({viewport:size}),frames=[],errors=[];let cdp;
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(`${base}/?renderer=dom&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
  await page.addStyleTag({content:'.runtime-loading-status { display:none !important; }'});
  await page.evaluate(async()=>{await scenePlayer.seekFrame(2196);await scenePlayer.whenIdle();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const baseline=greenFraction(await page.screenshot());assert(baseline>.01,'The first LED bars must be visible');
  cdp=await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame',event=>{frames.push(Buffer.from(event.data,'base64'));void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});});
  // Capture presented compositor frames. Awaited screenshots of paused poses
  // hide the partial/empty frames caused by perspective filter rasterization.
  await cdp.send('Page.startScreencast',{format:'png',maxWidth:640,maxHeight:360,everyNthFrame:1});
  const playback=await page.evaluate(async()=>{
   const p=scenePlayer,started=performance.now(),start=p.time*30;p.setPlaybackRate(1,4);await p.play();
   await new Promise(resolve=>{const tick=()=>{if(p.time*30<2207)requestAnimationFrame(tick);else {p.pause();resolve();}};requestAnimationFrame(tick);});
   return {start,end:p.time*30,elapsed:performance.now()-started};
  });
  await cdp.send('Page.stopScreencast');await cdp.detach();cdp=undefined;
  assert(frames.length>=10,`${label}: only ${frames.length} presented frames: ${JSON.stringify(playback)}`);
  const missing=frames.map((buffer,index)=>({buffer,index,green:greenFraction(buffer)})).filter(frame=>frame.green<baseline*.65);
  if(missing.length){const output=path.join(root,'test-results/dom-compositing');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,`${label}-${size.width}x${size.height}-missing.png`),missing[0].buffer);}
  assert.equal(missing.length,0,`${label} ${size.width}x${size.height}: existing bars vanished in ${missing.length}/${frames.length} presented frames`);
  await page.evaluate(async()=>{await scenePlayer.seekFrame(2210);await scenePlayer.whenIdle();});
  assert.equal(await page.locator('[data-entity^="helmet-bar-"] .pattern').evaluateAll(nodes=>nodes.some(node=>node.style.willChange!=='auto')),false,'Inactive bars release the compositor hint');
  assert.deepEqual(errors,[]);
  console.log(`${label} ${size.width}x${size.height}: ${frames.length} presented frames retained the LED bars; inactive layers released.`);
 }finally{if(cdp)await cdp.detach().catch(()=>{});await page.close();}
}

(async()=>{
 const server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const variants=[{name:'Chromium',options:{executablePath:chromium.executablePath()},sizes:[{width:1920,height:1080},{width:1080,height:1920}]}];
 const edge=[process.env['ProgramFiles(x86)'],process.env.ProgramFiles].filter(Boolean).some(directory=>fs.existsSync(path.join(directory,'Microsoft/Edge/Application/msedge.exe')));
 if(edge)variants.push({name:'Edge',options:{channel:'msedge'},sizes:[{width:1920,height:1080},{width:2560,height:1440}]});
 try{for(const variant of variants){const browser=await chromium.launch(variant.options);try{for(const size of variant.sizes)await check(browser,base,variant.name,size);}finally{await browser.close();}}}
 finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
