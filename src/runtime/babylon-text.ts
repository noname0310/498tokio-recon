import type * as Babylon from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {Scene} from "./scene.js";
import type {Entity,View,TextRenderer,PixelImage} from "./types.js";
import {textLayout,type TextLayout,type PreparedFont} from "./text.js";
import {Math3D as M} from "./math.js";
import {componentVariants} from "./preparation.js";

/** Canvas only rasterizes text. The retained plane follows normal transforms,
 * depth sorting, transition captures and camera postprocessing. */
export class BabylonText {
  readonly id:string;readonly mesh:Babylon.Mesh;readonly material:Babylon.ShaderMaterial;
  private texture?:Babylon.Texture;private key="";private layout?:TextLayout;
  private density=0;private revision=0;private disposed=false;
  constructor(readonly renderer:BabylonSceneContext,node:Entity){
    this.id=node.id;const B=renderer.B;
    this.material=new B.ShaderMaterial(`${node.name} / TextRenderer`,renderer.scene,{vertex:"sceneEntity",fragment:"sceneText"},{attributes:["position","uv"],uniforms:["worldViewProjection","tint"],samplers:["textTex"],needAlphaBlending:true});
    this.material.backFaceCulling=false;this.material.disableDepthWrite=true;
    this.mesh=renderer.quad(node.name,node.id,this.material);this.mesh.setEnabled(false);
  }
  private resolution(scene:Scene,view:View,c:TextRenderer,layout:TextLayout):number {
    const matrix=M.multiply(scene.viewMatrix,scene.world.get(this.id)!),b=layout.bounds,camera=scene.requireComponent(scene.cameraNode.id,"Camera");
    let magnification=0;
    for(const x of [b.left,b.right])for(const y of [b.bottom,b.top]){
      const p=M.point(matrix,{x,y,z:0}),depth=Math.max(camera.near,p.z),scale=scene.frustumScale(depth);
      const perspective=camera.projection==="perspective";
      for(const column of [0,4])magnification=Math.max(magnification,Math.hypot(matrix[column]-(perspective?p.x*matrix[column+2]/depth:0),matrix[column+1]-(perspective?p.y*matrix[column+2]/depth:0))/scale);
    }
    const em=Math.max(64,2**Math.ceil(Math.log2(Math.max(1,c.fontSize*magnification*view.pixelsPerUnit*view.dpr*2))));
    return BabylonText.density(this.renderer,c,layout,em);
  }
  private static density(r:BabylonSceneContext,c:TextRenderer,layout:TextLayout,em:number):number {
    const b=layout.bounds,width=Math.max(.001,b.right-b.left),height=Math.max(.001,b.top-b.bottom),limit=Math.min(4096,r.engine.getCaps().maxTextureSize)-4;
    return Math.min(em/c.fontSize,limit/width,limit/height,Math.sqrt(4194304/(width*height)));
  }
  private static pixels(r:BabylonSceneContext,c:TextRenderer,font:PreparedFont,layout:TextLayout,density:number):PixelImage {
    const key=JSON.stringify([c.asset,c.text,c.fontSize,c.letterSpacing,c.lineHeight,c.alignment,density]),cached=r.textImages.get(key);if(cached)return cached;
    const b=layout.bounds,pad=2,canvas=document.createElement("canvas");
    const width=Math.ceil((b.right-b.left)*density)+2*pad,height=Math.ceil((b.top-b.bottom)*density)+2*pad;
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("TextRenderer requires a 2D canvas context.");
    ctx.clearRect(0,0,width,height);ctx.font=`${c.fontSize*density}px "${font.family}"`;ctx.fontKerning="none";ctx.textRendering="geometricPrecision";
    ctx.letterSpacing=`${c.letterSpacing*density}px`;ctx.fillStyle="white";ctx.textBaseline="alphabetic";ctx.textAlign="left";
    for(const line of layout.lines)ctx.fillText(line.text,pad+(line.left-b.left)*density,pad+(line.top+font.ascent*c.fontSize+b.top)*density);
    const rgba=ctx.getImageData(0,0,width,height).data;
    const image:PixelImage={width,height,channels:4,data:new Uint8Array(rgba.buffer,rgba.byteOffset,rgba.byteLength)};r.textImages.set(key,image);canvas.width=canvas.height=1;return image;
  }
  /** Prepare display-resolution buckets, sharing pixels and GPU storage across
   * sequence lifetimes. Unexpected editor zooms still generate a larger bucket. */
  static async prepare(r:BabylonSceneContext,node:Entity,viewport:HTMLElement):Promise<void>{
    const scene=r.data,declared=new Map([...scene.declaredEntities()].map(n=>[n.id,n]));
    let scale=1,current:Entity|undefined=node;
    while(current&&!current.components.some(c=>c.type==="Camera")){
      const n:Entity=current;
      scale*=Math.max(...(["x","y","z"] as const).map(axis=>{const value=n.transform.localScale[axis],b=scene.sequence?.propertyBounds(n.id,{component:"Transform",path:`localScale.${axis}`},value);return b?Math.max(Math.abs(b.min),Math.abs(b.max)):Math.abs(value);}));
      const parent:string|undefined=scene.parents.get(n.id)?.id??scene.sequence?.templateParents.get(n.id);current=parent?declared.get(parent):undefined;
    }
    const height=Math.max(1,viewport.clientHeight)*(window.devicePixelRatio||1),cameras=[...declared.values()].flatMap(n=>n.components.filter(c=>c.type==="Camera"));
    const reference=Math.min(...cameras.map(c=>c.referenceVerticalSize));
    for(const c of componentVariants(scene,node,"TextRenderer",["fontSize","letterSpacing","lineHeight"])){
      const font=await r.resources.fonts.load(scene,c.asset);if(r.resources.disposed)return;
      const layout=textLayout(c,font);if(!layout.visible)continue;
      const maxEm=Math.max(64,2**Math.ceil(Math.log2(Math.max(1,c.fontSize*scale*height/reference*2))));
      let previous=0;
      for(let em=64;em<=maxEm;em*=2){
        const density=this.density(r,c,layout,em);if(density===previous)break;previous=density;
        const pixels=this.pixels(r,c,font,layout,density);r.texture(`${node.id}/text`,pixels,{linear:true}).dispose();
      }
    }
  }
  private rasterize(c:TextRenderer,font:PreparedFont,layout:TextLayout,density:number):void {
    const r=this.renderer,b=layout.bounds,pad=2,pixels=BabylonText.pixels(r,c,font,layout,density),height=pixels.height,width=pixels.width;
    this.texture?.dispose();this.texture=r.texture(`${this.id}/text`,pixels,{linear:true});this.material.setTexture("textTex",this.texture);
    r.rect(this.mesh,b.left-pad/density,b.top-(height-pad)/density,b.left+(width-pad)/density,b.top+pad/density);this.density=density;
  }
  async update(scene:Scene,view:View):Promise<void>{
    const revision=++this.revision,r=this.renderer,c=scene.requireComponent(this.id,"TextRenderer");
    if(!scene.active.get(this.id)||!c.enabled||!c.color.a||!r.resources.fonts.isReady(c.asset)){this.mesh.setEnabled(false);return;}
    const font=await r.resources.fonts.load(scene,c.asset);if(this.disposed||revision!==this.revision)return;
    const key=JSON.stringify([c.asset,c.text,c.fontSize,c.letterSpacing,c.lineHeight,c.alignment]),changed=key!==this.key;
    if(changed){this.layout=textLayout(c,font);this.key=key;}
    const layout=this.layout!;this.mesh.setEnabled(layout.visible);if(!layout.visible)return;
    const density=this.resolution(scene,view,c,layout);
    // Grow in resolution buckets, shrink with hysteresis. Translation, color
    // and opacity keep the canvas, GPU texture and mesh intact.
    if(changed||density>this.density*1.01||density<this.density*.4)this.rasterize(c,font,layout,density);
    r.tint(this.material,c.color);((this.mesh.metadata??={}) as {sortOrder:number}).sortOrder=c.sortingOrder;
  }
  dispose():void{this.disposed=true;this.revision++;this.texture?.dispose();this.mesh.dispose();this.material.dispose();}
}
