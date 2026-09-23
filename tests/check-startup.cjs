const assert=require('node:assert/strict');
const {chromium,firefox}=require('playwright');
const {makeServer}=require('./serve.cjs');

const camera={id:'camera',transform:{localPosition:{z:-10}},components:[{type:'Camera'}]};
const fixture={schemaVersion:1,assets:{bad:{type:'Sprite',file:'/broken.png',size:{x:1,y:1},pixelsPerUnit:1}},root:{id:'root',children:[camera]}};
async function alert(page,pattern){
  await page.waitForFunction(()=>document.getElementById('status')?.getAttribute('role')==='alert');
  assert.equal(await page.locator('#status').isVisible(),true);
  assert.match(await page.locator('#status').innerText(),pattern);
}
async function check(browser,base,renderer){
  let releaseAudio;
  const audioGate=new Promise(resolve=>releaseAudio=resolve),early=await browser.newPage(),errors=[];
  early.on('pageerror',error=>errors.push(error.message));
  await early.route('**/moon.png',route=>route.fulfill({status:404,body:'Missing image'}));
  await early.route('**/soundtrack.mp3',async route=>{await audioGate;await route.continue();});
  try{
    await early.goto(`${base}/?renderer=${renderer}&controls=0`,{waitUntil:'domcontentloaded'});
    await alert(early,/moon\.png.*HTTP 404/);
    assert.equal(await early.evaluate(()=>Boolean(window.scenePlayer)),false,'Startup waits for audio metadata');
    assert.equal(await early.locator('.runtime-loading-status').isVisible(),false,'Progress must not cover the error');
    releaseAudio();await early.waitForFunction(()=>window.scenePlayer?.ready);
    await alert(early,/moon\.png.*HTTP 404/);
    assert.equal(await early.evaluate(()=>scenePlayer.resources.isImageReady('moon')),false);
    assert.deepEqual(errors,[],'Early resource failures are handled');
  }finally{releaseAudio();await early.close();}

  let releaseImage;
  const imageGate=new Promise(resolve=>releaseImage=resolve),late=await browser.newPage();
  late.on('pageerror',error=>errors.push(error.message));
  await late.route('**/failure.scene.json',route=>route.fulfill({json:fixture}));
  await late.route('**/broken.png',async route=>{await imageGate;await route.fulfill({contentType:'image/png',body:'This is not a PNG.'});});
  try{
    await late.goto(`${base}/?scene=/failure.scene.json&renderer=${renderer}&controls=0`);
    await late.waitForFunction(()=>window.scenePlayer?.ready);
    assert.equal(await late.locator('#status').isVisible(),false);
    releaseImage();await alert(late,/broken\.png/);
    const failure=await late.evaluate(()=>scenePlayer.resources.whenLoaded.then(()=>null,error=>error.message));
    assert.match(failure,/broken\.png/);
    assert(!failure.includes('DataView'),'Native decoding reports a named resource failure');
    assert.deepEqual(errors,[],'Failures after startup are handled');
  }finally{releaseImage();await late.close();}

  const invalid=await browser.newPage();invalid.on('pageerror',error=>errors.push(error.message));
  await invalid.route('**/empty.scene.json',route=>route.fulfill({json:{...fixture,assets:{}}}));
  try{
    await invalid.goto(`${base}/?scene=/empty.scene.json&renderer=${renderer}&time=NaN`);
    await alert(invalid,/finite/);
    assert.equal(await invalid.locator('.runtime-loading-status').count(),0,'Failed initial seek disposes the engine');
    assert.equal(await invalid.locator('canvas').count(),0);
    assert.equal(await invalid.evaluate(()=>Boolean(window.scenePlayer)),false);
    assert.deepEqual(errors,[],'Failed initial seek is handled');
  }finally{await invalid.close();}
}
async function main(){
  const server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{for(const [name,type,renderer]of [['chromium-dom',chromium,'dom'],['chromium-babylon',chromium,'babylon'],['firefox-dom',firefox,'dom']]){
    const browser=await type.launch({headless:true});
    try{await check(browser,base,renderer);console.log(`${name}: early/late image errors, malformed PNGs and failed seek cleanup passed.`);}
    finally{await browser.close();}
  }}finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
