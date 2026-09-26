import type * as Babylon from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {Scene} from "./scene.js";
import type {Entity,View,TextRenderer} from "./types.js";
import {textLayout,type TextLayout,type PreparedFont} from "./text.js";
import {Math3D as M} from "./math.js";

/** Canvas only rasterizes text. The retained plane follows normal transforms,
 * depth sorting, transition captures and camera postprocessing. */
export class BabylonText {
  readonly id:string;readonly mesh:Babylon.Mesh;readonly material:Babylon.ShaderMaterial;
  private readonly canvas=document.createElement("canvas");
  private texture?:Babylon.RawTexture;private key="";private layout?:TextLayout;
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
    const width=Math.max(.001,b.right-b.left),height=Math.max(.001,b.top-b.bottom),limit=Math.min(4096,this.renderer.engine.getCaps().maxTextureSize)-4;
    return Math.min(em/c.fontSize,limit/width,limit/height,Math.sqrt(4194304/(width*height)));
  }
  private rasterize(c:TextRenderer,font:PreparedFont,layout:TextLayout,density:number):void {
    const r=this.renderer,b=layout.bounds,pad=2;
    const width=Math.ceil((b.right-b.left)*density)+2*pad,height=Math.ceil((b.top-b.bottom)*density)+2*pad;
    const resize=this.canvas.width!==width||this.canvas.height!==height;
    if(resize){this.canvas.width=width;this.canvas.height=height;}
    const ctx=this.canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("TextRenderer requires a 2D canvas context.");
    ctx.clearRect(0,0,width,height);ctx.font=`${c.fontSize*density}px "${font.family}"`;ctx.fontKerning="none";ctx.textRendering="geometricPrecision";
    ctx.letterSpacing=`${c.letterSpacing*density}px`;ctx.fillStyle="white";ctx.textBaseline="alphabetic";ctx.textAlign="left";
    for(const line of layout.lines)ctx.fillText(line.text,pad+(line.left-b.left)*density,pad+(line.top+font.ascent*c.fontSize+b.top)*density);
    const rgba=ctx.getImageData(0,0,width,height).data;
    if(!this.texture||resize){
      this.texture?.dispose();this.texture=r.B.RawTexture.CreateRGBATexture(rgba,width,height,r.scene,false,false,r.B.Texture.BILINEAR_SAMPLINGMODE);
      this.texture.name=`${this.id}/text`;this.texture.gammaSpace=false;this.texture.wrapU=this.texture.wrapV=r.B.Texture.CLAMP_ADDRESSMODE;this.material.setTexture("textTex",this.texture);
    }else this.texture.update(rgba);
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
  dispose():void{this.disposed=true;this.revision++;this.texture?.dispose();this.mesh.dispose();this.material.dispose();this.canvas.width=this.canvas.height=1;}
}
