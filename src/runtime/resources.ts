import type { Scene } from "./scene.js";
import type { PixelImage, Rect, TextureJob, ProceduralNoise } from "./types.js";
import { loadPixels, grayscalePng, rgbaPng } from "./png.js";
import { spriteRect } from "./atlas.js";
import type { TextureResponse } from "./texture-worker.js";

export class Resources {
  readonly images=new Map<string,Promise<PixelImage>>();
  readonly jobs=new Map<string,Promise<PixelImage>>();
  readonly atlasFrames=new Map<string,Promise<readonly HTMLImageElement[]>>();
  readonly urls=new Set<string>();
  readonly workers=new Set<{worker:Worker;reject:(reason:unknown)=>void}>();
  disposed=false;

  image(scene:Scene,id:string):Promise<PixelImage>{
    const url=scene.source(id),asset=scene.asset(id);
    if(!this.images.has(url))this.images.set(url,loadPixels(url));
    return this.images.get(url)!.then(image=>{if(image.width!==asset.size.x||image.height!==asset.size.y)throw new Error(`Asset dimensions do not match the scene: ${id}`);return image;});
  }
  crop(image:PixelImage,rect:Rect):PixelImage{
    const data=new Uint8Array(rect.width*rect.height*4);
    for(let y=0;y<rect.height;y++){const start=((rect.y+y)*image.width+rect.x)*4;data.set(image.data.subarray(start,start+rect.width*4),y*rect.width*4);}
    return {width:rect.width,height:rect.height,channels:4,data};
  }
  /** Canvas-free, one-time native cell decoding for DOM image sampling.
   * Firefox snaps the full atlas's bounds before clipping, changing the texel
   * phase per cell. Independent source bounds keep identical cells identical.
   * These cached images contain only source RGBA; effects remain live. */
  spriteFrames(scene:Scene,id:string):Promise<readonly HTMLImageElement[]>{
    const asset=scene.asset(id),key=JSON.stringify([scene.source(id),asset.size,asset.atlas]);
    let pending=this.atlasFrames.get(key);
    if(!pending){
      pending=this.image(scene,id).then(source=>Promise.all(Array.from({length:asset.atlas?.frameCount||1},async(_,frame)=>{
        const blob=await rgbaPng(this.crop(source,spriteRect(asset,frame)));
        if(this.disposed)throw new Error("Resources have been disposed.");
        const image=new Image(),url=URL.createObjectURL(blob);this.urls.add(url);image.src=url;await image.decode();return image;
      })));
      this.atlasFrames.set(key,pending);
      pending.catch(()=>{if(this.atlasFrames.get(key)===pending)this.atlasFrames.delete(key);});
    }
    return pending;
  }
  texture(key:string,input:TextureJob):Promise<PixelImage>{
    if(this.jobs.has(key))return this.jobs.get(key)!;
    const promise=new Promise<PixelImage>((resolve,reject)=>{
      if(this.disposed){reject(new Error("Resources have been disposed."));return;}
      const worker=new Worker(new URL("./texture-worker.ts",import.meta.url),{type:"module"});
      const record={worker,reject},cleanup=()=>{worker.terminate();this.workers.delete(record);};this.workers.add(record);
      worker.onmessage=({data}:MessageEvent<TextureResponse>)=>{cleanup();if(data.error!==undefined)reject(new Error(data.error));else resolve(data.result);};
      worker.onerror=e=>{cleanup();reject(new Error(e.message));};worker.postMessage(input);
    });
    this.jobs.set(key,promise);
    // Bound retained caches when parameters are animated or edited repeatedly.
    if(this.jobs.size>128)this.jobs.delete(this.jobs.keys().next().value!);
    promise.catch(()=>{if(this.jobs.get(key)===promise)this.jobs.delete(key);});return promise;
  }
  noiseKey(c:ProceduralNoise){return "noise:"+JSON.stringify([c.seed,c.textureSize,c.range,c.bands]);}
  noise(component:ProceduralNoise){return this.texture(this.noiseKey(component),{kind:"noise",component});}
  async noiseURL(component:ProceduralNoise){
    const result=await this.noise(component);
    const values=Uint8Array.from(result.data,v=>Math.round(255*Math.exp((v/255*2-1)*component.range)/2));
    const blob=await grayscalePng(values,result.width,result.height);
    if(this.disposed)throw new Error("Resources have been disposed.");
    const url=URL.createObjectURL(blob);this.urls.add(url);return {url,result};
  }
  releaseURL(url:string){if(this.urls.delete(url))URL.revokeObjectURL(url);}
  dispose(){this.disposed=true;for(const {worker,reject} of this.workers){worker.terminate();reject(new Error("Texture job cancelled."));}this.workers.clear();for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();this.jobs.clear();this.images.clear();this.atlasFrames.clear();}
}
