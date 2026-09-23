import type {Resources} from "./resources.js";
import type {Scene} from "./scene.js";
import type {Glow,Vec2} from "./types.js";
import type {LoadingProgress} from "./loading-status.js";
import {spriteRect} from "./atlas.js";
import {rgbaPng} from "./png.js";

interface GlowFrames {images:readonly HTMLImageElement[];padding:Vec2}

/** Retained Gaussian masks, shared by particles using the same artwork and
 * effect parameters. Geometry, tint, opacity and animation remain live DOM.
 * The existing texture worker evaluates eight samples per native sprite cell;
 * a large projected particle only composites an image, without another blur. */
export class DOMParticleGlow {
  private readonly cache=new Map<string,Promise<GlowFrames>>();
  constructor(private readonly resources:Resources){}
  private key(scene:Scene,id:string,glow:Glow):string {
    const asset=scene.asset(id);
    return JSON.stringify([scene.source(id),asset.size,asset.atlas,glow.sigmaWorld*asset.pixelsPerUnit,glow.threshold,glow.softness,glow.intensity*glow.color.a]);
  }
  frames(scene:Scene,id:string,glow:Glow):Promise<GlowFrames> {
    const key=this.key(scene,id,glow);let pending=this.cache.get(key);
    if(pending)return pending;
    pending=this.build(scene,id,glow,key);this.cache.set(key,pending);
    // Edits/animated filter parameters replace cached results; do not retain an
    // unbounded sequence of rasterizations. Existing DOM references stay valid.
    if(this.cache.size>32)this.cache.delete(this.cache.keys().next().value!);
    pending.catch(()=>{if(this.cache.get(key)===pending)this.cache.delete(key);});
    return pending;
  }
  private async build(scene:Scene,id:string,glow:Glow,key:string):Promise<GlowFrames> {
    const asset=scene.asset(id),source=await this.resources.image(scene,id);
    const padding={x:0,y:0},scale=8;
    const images=await Promise.all(Array.from({length:asset.atlas?.frameCount||1},async(_,frame)=>{
      const rect=spriteRect(asset,frame),cell=this.resources.crop(source,rect);
      const mask=await this.resources.texture(`particle-glow:${key}:${frame}`,{kind:"mask",source:cell,
        asset:{...asset,size:{x:rect.width,y:rect.height},pivot:{x:.5,y:.5},atlas:undefined},
        component:{...glow,type:"Glow"},resolution:asset.pixelsPerUnit*scale,gain:glow.intensity*glow.color.a});
      padding.x=(mask.width/scale-rect.width)/2;padding.y=(mask.height/scale-rect.height)/2;
      const data=new Uint8Array(mask.data.length*4).fill(255);
      for(let i=0;i<mask.data.length;i++)data[i*4+3]=mask.data[i];
      const blob=await rgbaPng({data,width:mask.width,height:mask.height,channels:4});
      // Data URLs follow their DOM/cache references when evicted. They need no
      // revocation while a surface still displays an older parameter variant.
      const url=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
      });
      if(this.resources.disposed)throw new Error("Resources have been disposed.");
      const image=new Image();image.src=url;await image.decode();return image;
    }));
    return {images,padding};
  }
  async prepare(scene:Scene,progress:LoadingProgress):Promise<void> {
    const jobs=new Map<string,{id:string;glow:Glow;name:string}>();
    for(const node of scene.declaredEntities()){
      const emitter=node.components.find(c=>c.type==="ParticleEmitter"),glow=node.components.find(c=>c.type==="Glow");
      if(!emitter||!glow||node.components.some(c=>c.type==="ParticleMotionBlur"))continue;
      const key=this.key(scene,emitter.asset,glow);if(!jobs.has(key))jobs.set(key,{id:emitter.asset,glow,name:node.name});
    }
    await Promise.all([...jobs.values()].map(async({id,glow,name})=>{
      const finish=progress.begin("Textures",`${name} / glow`);
      try{await this.frames(scene,id,glow);}finally{finish();}
    }));
  }
  dispose():void {this.cache.clear();}
}
