import type { PixelImage } from "./types.js";

/** Temporary CPU image preparation; these canvases never render the scene. */
function context2D(width:number,height:number):OffscreenCanvasRenderingContext2D {
  const context=new OffscreenCanvas(width,height).getContext("2d",{willReadFrequently:true});
  if(!context)throw new Error("Could not create an image preparation context.");
  return context;
}

export async function loadPixels(source:string):Promise<PixelImage> {
  const label=source.startsWith("data:")?"embedded image":source;
  try {
    const response=await fetch(source);
    if(!response.ok)throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    const bitmap=await createImageBitmap(await response.blob());
    try {
      const {width,height}=bitmap,context=context2D(width,height);
      try {
        context.drawImage(bitmap,0,0);
        const pixels=context.getImageData(0,0,width,height).data;
        return {width,height,channels:4,data:new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength)};
      }finally{context.canvas.width=context.canvas.height=1;}
    }finally{bitmap.close();}
  }catch(error){
    throw new Error(`Could not load image ${label}: ${error instanceof Error?error.message:String(error)}`,{cause:error});
  }
}

export function grayscalePng(pixels:Uint8Array,width:number,height:number):Promise<Blob> {
  const data=new Uint8Array(width*height*4);
  for(let i=0;i<pixels.length;i++){
    data[i*4]=data[i*4+1]=data[i*4+2]=pixels[i];data[i*4+3]=255;
  }
  return rgbaPng({width,height,channels:4,data});
}

export async function rgbaPng(image:PixelImage):Promise<Blob> {
  const context=context2D(image.width,image.height);
  try {
    const pixels=context.createImageData(image.width,image.height);
    pixels.data.set(image.data);context.putImageData(pixels,0,0);
    return await context.canvas.convertToBlob({type:"image/png"});
  }finally{context.canvas.width=context.canvas.height=1;}
}
