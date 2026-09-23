const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,firefox}=require('playwright'),{makeServer,root}=require('./serve.cjs');
const {png}=require('./pixel-check.cjs');

const images=fs.readdirSync(path.join(root,'assets'),{recursive:true}).filter(file=>file.endsWith('.png')).map(file=>{
  const source=png(fs.readFileSync(path.join(root,'assets',file))),rgba=[];
  for(let i=0;i<source.width*source.height;i++){
    const at=i*source.channels,gray=source.channels===1;
    rgba.push(source.pixels[at],source.pixels[at+(gray?0:1)],source.pixels[at+(gray?0:2)],source.channels===4?source.pixels[at+3]:255);
  }
  return {file:file.replaceAll('\\','/'),width:source.width,height:source.height,rgba};
});
async function main(){
  const server=makeServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{for(const [name,type]of [['chromium',chromium],['firefox',firefox]]){
    const browser=await type.launch({headless:true});
    try{
      const page=await browser.newPage();await page.route('**/image-test.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Image preparation</title>'}));
      await page.goto(`${base}/image-test.html`);
      const results=await page.evaluate(async images=>{
        const {Scene,Resources}=await import('/runtime/player.js');
        const assets=Object.fromEntries(images.map((im,i)=>['image'+i,{type:'Sprite',file:'/assets/'+im.file,size:{x:im.width,y:im.height},pixelsPerUnit:1}]));
        const scene=new Scene({schemaVersion:1,assets,root:{id:'root',children:[{id:'camera',components:[{type:'Camera'}]}]}},document.baseURI);
        const resources=new Resources();
        try{
          await resources.preload(scene,false);
          return await Promise.all(images.map(async(im,i)=>{
            const actual=await resources.image(scene,'image'+i);
            let opaqueMax=0,alphaMax=0,compositeMax=0;
            for(let k=0;k<actual.data.length;k+=4){
              const alpha=im.rgba[k+3];alphaMax=Math.max(alphaMax,Math.abs(actual.data[k+3]-alpha));
              for(let c=0;c<3;c++){
                if(alpha===255)opaqueMax=Math.max(opaqueMax,Math.abs(actual.data[k+c]-im.rgba[k+c]));
                compositeMax=Math.max(compositeMax,Math.abs(Math.round(actual.data[k+c]*actual.data[k+3]/255)-Math.round(im.rgba[k+c]*alpha/255)));
              }
            }
            return {file:im.file,width:actual.width,height:actual.height,opaqueMax,alphaMax,compositeMax};
          }));
        }finally{resources.dispose();}
      },images);
      for(let i=0;i<results.length;i++){
        const result=results[i];assert.equal(result.width,images[i].width);assert.equal(result.height,images[i].height);
        assert.equal(result.opaqueMax,0,`${result.file}: opaque palette must remain exact`);
        assert.equal(result.alphaMax,0,`${result.file}: alpha must remain exact`);
        // Canvas stores premultiplied color. Hidden RGB is discarded, and
        // recovering straight color can round by one displayed channel value.
        assert(result.compositeMax<=1,`${result.file}: ${JSON.stringify(result)}`);
      }
      assert.equal(await page.locator('canvas').count(),0,'Image preparation never adds a render surface');
      console.log(`${name}: ${results.length} PNGs retain dimensions, opaque colors, alpha and composited colors (within 1/255).`);
    }finally{await browser.close();}
  }}finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
