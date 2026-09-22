import type { PixelImage } from "./types.js";
/* Canvas-free source PNG decoding and procedural PNG encoding. */
export async function loadPixels(source:string):Promise<PixelImage> {
    // Decode the authored 8-bit PNG without a Canvas, including in file:// mode.
    const bytes = source.startsWith("data:") ? Uint8Array.from(atob(source.split(",")[1]),c=>c.charCodeAt(0)) : new Uint8Array(await (await fetch(source)).arrayBuffer());
    const view = new DataView(bytes.buffer); let offset=8,width=0,height=0,channels=0,colorType=0;let palette:Uint8Array|undefined,alpha:Uint8Array|undefined;
    const compressed:Uint8Array<ArrayBuffer>[]= [];
    while(offset<bytes.length){
      const length=view.getUint32(offset),type=String.fromCharCode(...bytes.subarray(offset+4,offset+8)),data=bytes.subarray(offset+8,offset+8+length);
      if(type==="IHDR"){
        width=view.getUint32(offset+8);height=view.getUint32(offset+12);colorType=data[9];channels=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[colorType];
        if(data[8]!==8||data[12]!==0||!channels)throw new Error("Source art must be a non-interlaced 8-bit PNG.");
      }
      if(type==="IDAT")compressed.push(data);if(type==="PLTE")palette=data;if(type==="tRNS")alpha=data;
      offset+=length+12;
    }
    const raw=new Uint8Array(await new Response(new Blob(compressed).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
    const stride=width*channels,decoded=new Uint8Array(width*height*channels),rgba=new Uint8Array(width*height*4);
    const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
    for(let y=0;y<height;y++)for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=channels?decoded[i-channels]:0,b=y?decoded[i-stride]:0,c=y&&x>=channels?decoded[i-stride-channels]:0;
      decoded[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][raw[y*(stride+1)]])&255;
    }
    for(let i=0;i<width*height;i++){
      const a=i*channels,b=i*4,v=decoded[a];
      if(colorType===3){rgba[b]=palette![v*3];rgba[b+1]=palette![v*3+1];rgba[b+2]=palette![v*3+2];rgba[b+3]=alpha?.[v]??255;}
      else {const gray=colorType===0||colorType===4;rgba[b]=v;rgba[b+1]=decoded[a+(gray?0:1)];rgba[b+2]=decoded[a+(gray?0:2)];rgba[b+3]=colorType===4?decoded[a+1]:colorType===6?decoded[a+3]:255;}
    }
    return {width,height,channels:4,data:rgba};
  }
export function grayscalePng(pixels:Uint8Array,width:number,height:number):Promise<Blob>{return encodePng(pixels,width,height,1);}
export function rgbaPng(image:PixelImage):Promise<Blob>{return encodePng(image.data,image.width,image.height,4);}
async function encodePng(pixels:Uint8Array,width:number,height:number,channels:1|4):Promise<Blob> {
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let value = n;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[n] = value >>> 0;
    }
    function chunk(type:string, data:Uint8Array) {
      const output = new Uint8Array(data.length + 12);
      const view = new DataView(output.buffer);
      view.setUint32(0, data.length);
      for (let i = 0; i < 4; i++) output[4 + i] = type.charCodeAt(i);
      output.set(data, 8);
      let crc = 0xffffffff;
      for (let i = 4; i < output.length - 4; i++) crc = crcTable[(crc ^ output[i]) & 255] ^ (crc >>> 8);
      view.setUint32(output.length - 4, (crc ^ 0xffffffff) >>> 0);
      return output;
    }
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width); view.setUint32(4, height); header[8] = 8;header[9]=channels===4?6:0;
    const stride=width*channels,scanlines = new Uint8Array(height * (stride + 1));
    for (let y = 0; y < height; y++) scanlines.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    const compressed = new Uint8Array(await new Response(new Blob([scanlines]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())], { type: "image/png" });
  }
