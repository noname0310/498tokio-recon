const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs');

// Golden byte hashes from the original scalar convolution, before loop
// unrolling. Cover row tails, wide wrapped kernels, alpha and zero bands.
const expected={
  '498360':'b3c2cd4559f629880621dcd1259bbd2b0397c908bfe9b52959e9bf06a8f4caba',
  '4981158':'ca6cd1f796b2eccc0079d1eb151145add63c159bd05935df187d559e4fbff3d4',
  '4981227':'c68cbc536d2cd4c5dad4931f09274ad5efdb40022d9335cf83972ac797a97272',
  '4982097':'6a8c348eb904dca87b1d3c1c6a80c3c5070fb1f929b2d2d3808d5823ace07561',
  '4984401':'f662a9fbee6fc474249a8e0a3ecfb7ecfb547acb4f1993a52510761143b82b6a',
  'noise-1x1':'76be8b528d0075f7aae98d6fa57a6d3c83ae480a8469e668d7b0af968995ac71',
  'noise-2x3':'0d535386f94ef8cf25283ccb1b5261af4e36527fe8876c12dc02cff7b72abad8',
  'noise-3x5':'74d068ce4407fadcf2c344ba30fd16bbb6f4104e353c6394e20955d3215b2cec',
  'noise-4x3':'2ec92e39c5b0b291cf173fa2410ebba3555bb7db01ee1a254aa3d4d6e6cf327c',
  'noise-7x9':'6a454c702c6be61783bb0edee90a73ea2c892d5f8f72504822e56bf2c50dd047',
  'tile-false-false':'b5960c63a46e55e942a8e7c2766c3eded166cb33d3c00618fc229ebae8f47b16',
  'mask-false-Glow':'31e2622fd62e4469563af34c4bbae9ddc4fce98fcb6de8039c95b1454bd78467',
  'mask-false-DropShadow':'9aeb52095f7db6e877af5b551b90bd7e57e2d7c8b46c0bb5ac0789dd5dd80495',
  'tile-false-true':'278faadbf0747591879a633d5b2af1546b143e6841ad9996204d303a6b3b6b3b',
  'tile-true-false':'02c1aa1cb53f66796d257aabaa822d2e6326de13b194cf1098f4713d1bf6e19d',
  'mask-true-Glow':'50fb9d1135a67b8dd1d75aa0a1f6a494400b34db14a348ff0418bd3352c1473f',
  'mask-true-DropShadow':'394416acbd284ca7e25a2b7605412eaafb92bc24c6d614a33e6ef19d9088edaf',
  'tile-true-true':'30f5cd901360f207f4e56ebef17f212a24edb9fbd7cb713fd5c701f0aa500612'
};
function cases(){
  const jobs=[];
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='ProceduralNoise'&&!jobs.some(job=>job.name===String(node.seed)))jobs.push({name:String(node.seed),input:{kind:'noise',component:node}});
    for(const value of Object.values(node))visit(value);
  }
  visit(JSON.parse(fs.readFileSync(path.join(root,'assets/final_animation.scene.json'),'utf8')));
  for(const [width,height] of [[1,1],[2,3],[3,5],[4,3],[7,9]]){
    jobs.push({name:`noise-${width}x${height}`,input:{kind:'noise',component:{seed:0xffffffff,textureSize:{x:width,y:height},range:.4,bands:[
      {sigmaTexels:{x:0,y:0},variance:.01},
      {sigmaTexels:{x:8,y:8},variance:0},
      {sigmaTexels:{x:6,y:.65},variance:.03}
    ]}}});
  }
  for(const alpha of [false,true])for(const repeatY of [false,true]){
    const source={width:3,height:5,channels:4,data:Array.from({length:60},(_,i)=>i%4===3?(alpha?(i*43)%256:255):(i*71)%256)};
    const asset={pixelsPerUnit:2,pivot:{x:.2,y:.8}};
    jobs.push({name:`tile-${alpha}-${repeatY}`,input:{kind:'tile',source,asset,resolution:3,sigmaWorld:{x:2,y:.7},repeatY}});
    if(!repeatY)for(const type of ['Glow','DropShadow'])jobs.push({name:`mask-${alpha}-${type}`,input:{kind:'mask',source,asset,resolution:3,component:{type,sigmaWorld:.3,threshold:.2,softness:.4}}});
  }
  return jobs;
}
async function main(){
  const server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,jobs=cases();
  try{for(const [name,type] of [['chromium',chromium],['firefox',firefox]]){
    const browser=await type.launch({headless:true});
    try{
      const page=await browser.newPage();await page.route('**/procedural-test.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Procedural textures</title>'}));
      await page.goto(`${base}/procedural-test.html`);
      const results=await page.evaluate(async jobs=>{
        const {TextureProcessor,Resources}=await import('/runtime/player.js'),processor=new TextureProcessor(),resources=new Resources();
        try{
          const results=[];
          for(const {name,input} of jobs){
            if(input.source)input.source.data=Uint8Array.from(input.source.data);
            const result=await processor.run(input);
            const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',result.data)),v=>v.toString(16).padStart(2,'0')).join('');
            results.push({name,hash});
          }
          // Check all 256 LUT entries, not just values present in one noise.
          const field={width:256,height:1,channels:1,data:Uint8Array.from({length:256},(_,i)=>i)};
          resources.noise=async()=>field;
          for(const range of [.05,.12,.4]){
            const {image}=await resources.noiseURL({...jobs[0].input.component,range});
            const context=new OffscreenCanvas(256,1).getContext('2d');context.drawImage(image,0,0);
            const actual=context.getImageData(0,0,256,1).data;
            const expected=Uint8Array.from(field.data,v=>Math.round(255*Math.exp((v/255*2-1)*range)/2));
            for(let i=0;i<256;i++)if(actual[i*4]!==expected[i]||actual[i*4+1]!==expected[i]||actual[i*4+2]!==expected[i]||actual[i*4+3]!==255)throw new Error(`Noise transfer mismatch at ${range}/${i}`);
          }
          return results;
        }finally{processor.dispose();resources.dispose();}
      },jobs);
      for(const result of results)assert.equal(result.hash,expected[result.name],`${name}: ${result.name} changed pixels`);
      console.log(`${name}: ${results.length} procedural textures retain exact bytes; all noise transfer values match.`);
    }finally{await browser.close();}
  }}finally{await new Promise(resolve=>server.close(resolve));}
}
module.exports={cases};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
