import type * as Babylon from "@babylonjs/core/pure";
import type {BabylonRenderer} from "./babylon.js";
import type {Scene} from "./scene.js";
import type {Entity,View} from "./types.js";
import {numberLayout} from "./sprite-number.js";

export class BabylonNumber {
  readonly id:string;readonly mesh:Babylon.Mesh;readonly material:Babylon.ShaderMaterial;
  private texture?:Babylon.RawTexture;private source="";private revision=0;
  constructor(readonly renderer:BabylonRenderer,node:Entity){
    this.id=node.id;const B=renderer.B;
    this.material=new B.ShaderMaterial(`${node.name} / SpriteNumberRenderer`,renderer.scene,{vertex:"sceneEntity",fragment:"sceneNumber"},{attributes:["position","uv"],uniforms:["worldViewProjection","tint","units","cell","atlasSize","columns","padding","glyphCount","glyphFrames","glyphStarts","textLeft","period","repeated","sigma","gain"],samplers:["glyphTex"],needAlphaBlending:true});
    this.material.backFaceCulling=false;this.material.disableDepthWrite=true;this.mesh=renderer.quad(node.name,node.id,this.material);
  }
  async update(scene:Scene,view:View):Promise<void>{
    const revision=++this.revision,r=this.renderer,c=scene.requireComponent(this.id,"SpriteNumberRenderer"),m=this.material;
    if(!scene.active.get(this.id)||!c.enabled||!c.color.a){this.mesh.setEnabled(false);return;}
    const asset=scene.asset(c.asset),layout=numberLayout(c,asset),bounds=c.repeatWorld?scene.coverage(this.id,view):layout.bounds;
    this.mesh.setEnabled(!!bounds);if(!bounds)return;
    if(this.source!==scene.source(c.asset)){
      const source=scene.source(c.asset),pixels=await r.resources.image(scene,c.asset);if(revision!==this.revision)return;
      this.source=source;this.texture?.dispose();this.texture=r.texture(`${this.id}/glyphs`,pixels);m.setTexture("glyphTex",this.texture);
    }
    const glow=scene.component(this.id,"Glow"),pad=glow?.enabled?4*glow.sigmaWorld:0;
    r.rect(this.mesh,bounds.left-pad,bounds.bottom-pad,bounds.right+pad,bounds.top+pad);r.tint(m,c.color);
    m.setFloat("units",asset.pixelsPerUnit);r.vec2(m,"cell",asset.atlas!.cellSize);r.vec2(m,"atlasSize",asset.size);m.setFloat("columns",asset.atlas!.columns);m.setFloat("padding",asset.atlas!.padding??0);
    m.setInt("glyphCount",layout.frames.length);m.setFloats("glyphFrames",layout.frames.concat(Array(32-layout.frames.length).fill(0)));m.setFloats("glyphStarts",layout.starts.concat(Array(32-layout.starts.length).fill(0)));
    m.setFloat("textLeft",layout.left);r.vec2(m,"period",c.repeatWorld?{x:c.repeatWorld.x*asset.pixelsPerUnit,y:c.repeatWorld.y*asset.pixelsPerUnit}:{x:layout.width,y:layout.height});m.setFloat("repeated",c.repeatWorld?1:0);
    m.setFloat("sigma",glow?.enabled?glow.sigmaWorld*asset.pixelsPerUnit:0);m.setFloat("gain",glow?.enabled?glow.intensity:0);
  }
  dispose():void{this.revision++;this.texture?.dispose();this.mesh.dispose();this.material.dispose();}
}
