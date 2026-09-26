import type { Scene } from "./scene.js";
import type { PixelImage, Rect, TextureJob, ProceduralNoise } from "./types.js";
import { loadPixels, grayscalePng, rgbaPng } from "./png.js";
import { spriteRect } from "./atlas.js";
import {TextureProcessor,type TextureWorkerFactory} from "./texture-processor.js";
import type {LoadingProgress} from "./loading-status.js";
import {scanlineNoise} from "./scanline-jitter.js";

export class Resources {
  readonly images=new Map<string,Promise<PixelImage>>();
  readonly jobs=new Map<string,Promise<PixelImage>>();
  readonly atlasFrames=new Map<string,Promise<readonly HTMLImageElement[]>>();
  private readonly atlasPixels=new Map<string,Promise<PixelImage>>();
  readonly decodedImages=new Map<string,Promise<HTMLImageElement>>();
  private readonly filterImages=new Map<string,Promise<HTMLImageElement>>();
  private readonly noiseImages=new Map<string,Promise<{url:string;result:PixelImage;image:HTMLImageElement}>>();
  private readonly scanlines=new Map<number,PixelImage>();
  private readonly scanlineImages=new Map<number,Promise<string>>();
  readonly urls=new Set<string>();
  private readonly processor:TextureProcessor;
  private preloading=false;private readonly prepared=new Set<string>();
  whenLoaded:Promise<void>=Promise.resolve();
  disposed=false;
  constructor(workerFactory?:TextureWorkerFactory,private readonly progress?:LoadingProgress,private readonly imageReady?:()=>void){this.processor=new TextureProcessor(workerFactory);}

  /** Start every image now. Renderers skip unfinished assets without stalling. */
  preload(scene:Scene,domFrames:boolean):Promise<void>{
    this.preloading=true;const unique=new Map<string,string[]>();
    const filterAssets=new Set<string>();
    if(domFrames)for(const node of scene.declaredEntities())for(const c of node.components)if(c.type==="SecondaryTexture")filterAssets.add(c.asset);
    for(const [id,asset]of Object.entries(scene.data.assets))if(asset.type==="Sprite"){
      const key=JSON.stringify([scene.source(id),asset.size,asset.atlas]),ids=unique.get(key);
      if(ids)ids.push(id);else unique.set(key,[id]);
    }
    return this.whenLoaded=Promise.all([...unique.values()].map(async ids=>{
      const id=ids[0];
      const file=scene.asset(id).file,name=file.startsWith("data:")?id:file.split("/").at(-1)||id;
      const finish=this.progress?.begin("Images",name);
      try {
        await this.image(scene,id);
        if(domFrames)await this.spriteFrames(scene,id);
        const filterId=ids.find(alias=>filterAssets.has(alias));if(filterId)await this.filterImage(scene,filterId);
        if(!this.disposed){for(const alias of ids)this.prepared.add(alias);this.imageReady?.();}
      }catch(error){
        throw new Error(`Could not prepare ${name}: ${error instanceof Error?error.message:String(error)}`,{cause:error});
      }finally{finish?.();}
    })).then(async()=>{
      if(this.disposed)return;
      const noises=new Map<string,{name:string;component:ProceduralNoise}>();
      for(const node of scene.declaredEntities())for(const c of node.components)if(c.type==="ProceduralNoise"){
        const key=this.noiseKey(c);if(!noises.has(key))noises.set(key,{name:node.name,component:c});
      }
      await Promise.all([...noises.values()].map(async({name,component})=>{
        const finish=this.progress?.begin("Textures",`${name} / noise`);
        try{if(domFrames)await this.noiseURL(component);else await this.noise(component);}
        finally{finish?.();}
      }));
      const seeds=new Set<number>();
      for(const node of scene.declaredEntities())for(const c of node.components)if(c.type==="ScanlineJitter")seeds.add(c.seed);
      await Promise.all([...seeds].map(async seed=>{
        const finish=this.progress?.begin("Textures","Scanline jitter");
        try{if(domFrames)await this.scanlineURL(seed);else this.scanline(seed);}finally{finish?.();}
      }));
    });
  }
  isImageReady(id:string):boolean{return !this.preloading||this.prepared.has(id);}

  decodedImage(scene:Scene,id:string):Promise<HTMLImageElement>{
    const source=scene.source(id);let pending=this.decodedImages.get(source);
    if(!pending){
      const image=new Image();image.src=source;pending=image.decode().then(()=>image);this.decodedImages.set(source,pending);
      pending.catch(()=>{if(this.decodedImages.get(source)===pending)this.decodedImages.delete(source);});
    }
    return pending;
  }

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
  /** Source cells are immutable and shared by every tiled instance. */
  framePixels(scene:Scene,id:string,frame:number):Promise<PixelImage>{
    const asset=scene.asset(id);if(!asset.atlas)return this.image(scene,id);
    const rect=spriteRect(asset,frame),key=JSON.stringify([scene.source(id),rect]);
    let pending=this.atlasPixels.get(key);
    if(!pending){pending=this.image(scene,id).then(source=>this.crop(source,rect));this.atlasPixels.set(key,pending);}
    return pending;
  }
  /** One-time cell preparation for DOM image sampling.
   * Firefox snaps the full atlas's bounds before clipping, changing the texel
   * phase per cell. Independent source bounds keep identical cells identical.
   * These cached images contain only source RGBA; effects remain live. */
  spriteFrames(scene:Scene,id:string):Promise<readonly HTMLImageElement[]>{
    const asset=scene.asset(id),key=JSON.stringify([scene.source(id),asset.size,asset.atlas]);
    let pending=this.atlasFrames.get(key);
    if(!pending){
      pending=!asset.atlas?this.decodedImage(scene,id).then(image=>[image]):this.image(scene,id).then(source=>Promise.all(Array.from({length:asset.atlas?.frameCount||1},async(_,frame)=>{
        const blob=await rgbaPng(this.crop(source,spriteRect(asset,frame)));
        if(this.disposed)throw new Error("Resources have been disposed.");
        const image=new Image(),url=URL.createObjectURL(blob);this.urls.add(url);image.src=url;await image.decode();return image;
      })));
      this.atlasFrames.set(key,pending);
      pending.catch(()=>{if(this.atlasFrames.get(key)===pending)this.atlasFrames.delete(key);});
    }
    return pending;
  }
  /** SVG feImage ignores nearest-neighbor sampling in some browsers. Expand
   * immutable source texels once; UVs, alpha and all compositing stay live. */
  filterImage(scene:Scene,id:string):Promise<HTMLImageElement>{
    if(scene.asset(id).filter!=="point")return this.decodedImage(scene,id);
    const key=scene.source(id);let pending=this.filterImages.get(key);
    if(!pending){
      pending=this.image(scene,id).then(async source=>{
        const factor=Math.max(1,Math.min(8,2**Math.floor(Math.log2(Math.sqrt(4194304/(source.width*source.height))))));
        if(factor===1)return this.decodedImage(scene,id);
        const width=source.width*factor,height=source.height*factor,data=new Uint8Array(width*height*4);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
          const from=(Math.floor(y/factor)*source.width+Math.floor(x/factor))*4,to=(y*width+x)*4;
          data[to]=source.data[from];data[to+1]=source.data[from+1];data[to+2]=source.data[from+2];data[to+3]=source.data[from+3];
        }
        const blob=await rgbaPng({width,height,channels:4,data});
        if(this.disposed)throw new Error("Resources have been disposed.");
        const image=new Image(),url=URL.createObjectURL(blob);this.urls.add(url);image.src=url;
        try{await image.decode();return image;}catch(error){this.releaseURL(url);throw error;}
      });
      this.filterImages.set(key,pending);
      pending.catch(()=>{if(this.filterImages.get(key)===pending)this.filterImages.delete(key);});
    }
    return pending;
  }
  texture(key:string,input:TextureJob):Promise<PixelImage>{
    if(this.jobs.has(key))return this.jobs.get(key)!;
    const promise=this.processor.run(input);
    this.jobs.set(key,promise);
    // Bound retained caches when parameters are animated or edited repeatedly.
    if(this.jobs.size>128)this.jobs.delete(this.jobs.keys().next().value!);
    promise.catch(()=>{if(this.jobs.get(key)===promise)this.jobs.delete(key);});return promise;
  }
  noiseKey(c:ProceduralNoise){return "noise:"+JSON.stringify([c.seed,c.textureSize,c.range,c.bands]);}
  noise(component:ProceduralNoise){return this.texture(this.noiseKey(component),{kind:"noise",component});}
  /** Resources owns these decoded URLs for the whole scene, across despawns. */
  noiseURL(component:ProceduralNoise){
    const key=this.noiseKey(component);let pending=this.noiseImages.get(key);
    if(!pending){
      pending=(async()=>{
        const result=await this.noise(component);
        // The field is already quantized to 256 values. Evaluate the transfer
        // curve once per possible byte instead of once per texture pixel.
        const transfer=new Uint8Array(256),values=new Uint8Array(result.data.length);
        for(let v=0;v<transfer.length;v++)transfer[v]=Math.round(255*Math.exp((v/255*2-1)*component.range)/2);
        for(let i=0;i<values.length;i++)values[i]=transfer[result.data[i]];
        const blob=await grayscalePng(values,result.width,result.height);
        if(this.disposed)throw new Error("Resources have been disposed.");
        const url=URL.createObjectURL(blob);this.urls.add(url);
        const image=new Image();image.src=url;
        try{await image.decode();}catch(error){this.releaseURL(url);throw error;}
        return {url,result,image};
      })();
      this.noiseImages.set(key,pending);
      pending.catch(()=>{if(this.noiseImages.get(key)===pending)this.noiseImages.delete(key);});
    }
    return pending;
  }
  releaseURL(url:string){if(this.urls.delete(url))URL.revokeObjectURL(url);}
  scanline(seed:number):PixelImage {
    let pixels=this.scanlines.get(seed);if(!pixels){pixels=scanlineNoise(seed);this.scanlines.set(seed,pixels);}return pixels;
  }
  scanlineURL(seed:number):Promise<string> {
    let pending=this.scanlineImages.get(seed);
    if(!pending){
      pending=rgbaPng(this.scanline(seed)).then(async blob=>{
        if(this.disposed)throw new Error("Resources have been disposed.");
        const url=URL.createObjectURL(blob);this.urls.add(url);const image=new Image();image.src=url;
        try{await image.decode();return url;}catch(error){this.releaseURL(url);throw error;}
      });
      this.scanlineImages.set(seed,pending);pending.catch(()=>{if(this.scanlineImages.get(seed)===pending)this.scanlineImages.delete(seed);});
    }
    return pending;
  }
  dispose(){this.disposed=true;this.processor.dispose();for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();this.jobs.clear();this.images.clear();this.atlasFrames.clear();this.atlasPixels.clear();this.decodedImages.clear();this.filterImages.clear();this.noiseImages.clear();this.scanlines.clear();this.scanlineImages.clear();this.prepared.clear();}
}
