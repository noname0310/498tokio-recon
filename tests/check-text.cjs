const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs'),{png}=require('./pixel-check.cjs');
function silhouette(a,b){
  const p=png(a),q=png(b);assert.equal(p.width,q.width);assert.equal(p.height,q.height);
  let common=0,total=0;
  for(let i=0;i<p.width*p.height;i++){const x=p.pixels[i*p.channels]>127,y=q.pixels[i*q.channels]>127;if(x||y)total++;if(x&&y)common++;}
  assert(total>1000,'Text must be visible');return common/total;
}
async function main(){
  const server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const screenshots={};
  try{for(const [name,type]of [['chromium',chromium],['firefox',firefox]]){
    const browser=await type.launch({headless:!(name==='firefox'&&process.platform==='linux'),...(name==='firefox'?{firefoxUserPrefs:{'webgl.force-enabled':true,'webgl.enable-webgl2':true}}:{})});
    try{for(const mode of ['dom','babylon']){
      const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[],requests=[];
      page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
      await page.addInitScript(mode=>{
        window.textDraws=0;
        if(mode==='dom')HTMLCanvasElement.prototype.getContext=()=>{throw new Error('DOM text must not use canvas');};
        else {const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(...args){window.textDraws++;return original.apply(this,args);};}
      },mode);
      await page.goto(`${origin}/?scene=assets/ending/text.scene.json&renderer=${mode}&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);await page.evaluate(()=>scenePlayer.whenIdle());
      const capture=async()=>{await page.bringToFront();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return page.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'});};
      screenshots[`${name}-${mode}`]=await capture();
      assert.equal(requests.filter(u=>u.endsWith('.woff2')).length,1,'All labels share one font download');
      assert.equal(await page.evaluate(()=>document.fonts.size),1);
      const reuse=await page.evaluate(async mode=>{
        const p=scenePlayer,o=p.renderer.objects.find(o=>o.id==='text-title'),texture=o.texture,draws=window.textDraws,element=o.element,mesh=o.mesh;
        const records=[],observer=new MutationObserver(m=>records.push(...m));if(element)observer.observe(element,{subtree:true,attributes:true,childList:true,characterData:true});
        for(let frame=0;frame<12;frame++)await p.seekFrame(frame);
        await p.whenIdle();await Promise.resolve();observer.disconnect();
        const stable=records.length===0&&window.textDraws===draws;
        await p.setComponent('text-title','TextRenderer',{color:{r:.6,g:.8,b:1,a:.5}});await p.setTransform('text-title',{localPosition:{x:.7}});await p.whenIdle();
        return {stable,same:mode==='dom'?element===o.element:mesh===o.mesh&&texture===o.texture,drawsUnchanged:window.textDraws===draws};
      },mode);
      assert.deepEqual(reuse,{stable:true,same:true,drawsUnchanged:true});
      await page.evaluate(async()=>{await scenePlayer.setComponent('text-title','TextRenderer',{text:'THANK YOU\n４９８',alignment:'center',letterSpacing:.02,lineHeight:1.25,color:{r:1,g:1,b:1,a:1}});await scenePlayer.setTransform('text-title',{localPosition:{x:0,y:.6}});await scenePlayer.whenIdle();});
      screenshots[`${name}-${mode}-multiline`]=await capture();
      if(mode==='babylon'){
        const resized=await page.evaluate(async()=>{
          const p=scenePlayer,o=p.renderer.objects.find(o=>o.id==='text-title'),old=o.texture.getSize().width,draws=window.textDraws;
          await p.setTransform(o.id,{localScale:{x:4,y:4,z:1}});await p.whenIdle();const large=o.texture.getSize().width;
          const after=window.textDraws;for(let i=0;i<5;i++)await p.seekFrame(i);await p.whenIdle();
          return {old,large,regenerated:after>draws,stable:after===window.textDraws};
        });assert(resized.large>resized.old&&resized.regenerated&&resized.stable,JSON.stringify(resized));
      }
      await page.evaluate(()=>scenePlayer.dispose());assert.equal(await page.evaluate(()=>document.fonts.size),0,'Scene disposal releases the font');
      assert.deepEqual(errors,[]);await page.close();
    }
    for(const suffix of ['','-multiline']){const overlap=silhouette(screenshots[`${name}-dom${suffix}`],screenshots[`${name}-babylon${suffix}`]);assert(overlap>.90,`${name}${suffix} DOM/canvas silhouette agreement: ${overlap}`);console.log(`${name}${suffix}: ${(overlap*100).toFixed(2)}% silhouette overlap`);}
    const portable=await browser.newPage({viewport:{width:640,height:360}}),requests=[];
    await portable.route(/^https?:/,r=>r.abort());portable.on('request',r=>{if(/\.woff2(?:$|\?)/.test(r.url()))requests.push(r.url());});
    await portable.goto(pathToFileURL(path.join(root,'dist/standalone/index.html')).href+'?controls=0');await portable.waitForFunction(()=>window.scenePlayer?.ready);await portable.evaluate(()=>scenePlayer.whenIdle());
    const fixture=JSON.parse(fs.readFileSync(path.join(root,'assets/ending/text.scene.json'),'utf8'));
    await portable.evaluate(async data=>{await scenePlayer.loadScene(data,{baseURL:new URL('assets/ending/text.scene.json',document.baseURI).href});await scenePlayer.whenIdle();},fixture);
    assert.deepEqual(requests,[],'Standalone text must load its embedded font');assert.equal(await portable.evaluate(()=>document.fonts.size),1);
    await portable.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert(silhouette(await portable.screenshot({style:'.runtime-loading-status{visibility:hidden!important}'}),screenshots[`${name}-babylon`])>.995,'Standalone and external fonts must render alike');await portable.close();
    }finally{await browser.close();}
  }}finally{await new Promise(r=>server.close(r));}
  const fonts=fs.readdirSync(path.join(root,'assets/fonts'));assert(!fonts.some(f=>/msdf|\.png$/.test(f)));assert(fs.statSync(path.join(root,'assets/fonts/misaki-gothic.woff2')).size<2000);
  console.log('Shared webfont, DOM without canvas, live text edits, adaptive resolution, retained textures and cleanup passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
