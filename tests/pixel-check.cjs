const assert=require("node:assert/strict");
const zlib = require('node:zlib');
function png(buffer) {
  let offset=8,width,height,channels;const parts=[];
  while(offset<buffer.length){const size=buffer.readUInt32BE(offset),type=buffer.toString('ascii',offset+4,offset+8),data=buffer.subarray(offset+8,offset+8+size);
    if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);channels={0:1,2:3,6:4}[data[9]];assert(channels);}
    if(type==='IDAT')parts.push(data);offset+=size+12;
  }
  const raw=zlib.inflateSync(Buffer.concat(parts)),stride=width*channels,pixels=Buffer.alloc(width*height*channels);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];for(let x=0;x<stride;x++){
    const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;
    pixels[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
  }}return {width,height,channels,pixels};
}
function compare(actual,expected) {
  const a=png(actual),b=png(expected);assert.equal(a.width,b.width);assert.equal(a.height,b.height);let max=0,sum=0;
  for(let i=0;i<a.width*a.height;i++)for(let c=0;c<3;c++){const d=Math.abs(a.pixels[i*a.channels+c]-b.pixels[i*b.channels+c]);max=Math.max(max,d);sum+=d;}
  return {max,mae:sum/(a.width*a.height*3)};
}
function closePixels(actual,expected,message) {const difference=compare(actual,expected);assert(difference.max<=1&&difference.mae<.001,`${message}: ${JSON.stringify(difference)}`);return difference;}
function checkClamp(buffer,view,sourceBuffer) {
  const image=png(buffer),source=png(sourceBuffer),palette=new Set();
  for(let i=0;i<source.width*source.height;i++)palette.add([...source.pixels.subarray(i*source.channels,i*source.channels+3)].join(','));
  let outsidePalette=0,joinSamples=0,joinMaxError=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const i=(y*image.width+x)*image.channels,color=[...image.pixels.subarray(i,i+3)];
    if(!palette.has(color.join(',')))outsidePalette++;
    const localY=(view.height/2-y-.5)/view.pixelsPerUnit;
    if(Math.abs(Math.abs(localY)-1.8)*view.pixelsPerUnit>3)continue;
    const localX=(x+.5-view.width/2)/view.pixelsPerUnit,gx=(localX+3.2)*10;
    const fraction=gx-Math.floor(gx);
    if(Math.min(fraction,1-fraction)*view.pixelsPerUnit/10<1.1)continue;
    const col=((Math.floor(gx)%8)+8)%8,row=Math.min(35,Math.max(0,Math.floor((1.8-localY)*10)));
    const j=(row*source.width+col)*source.channels;
    for(let c=0;c<3;c++)joinMaxError=Math.max(joinMaxError,Math.abs(color[c]-source.pixels[j+c]));
    joinSamples++;
  }
  assert.equal(outsidePalette,0,'Effects-off background must retain the native palette at fractional zoom');
  assert(joinSamples>1000);assert.equal(joinMaxError,0,'Both clamped boundaries must match their source edge row without a seam');
  return {outsidePalette,joinSamples,joinMaxError};
}

module.exports={png,compare,closePixels,checkClamp};
