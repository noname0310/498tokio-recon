import type * as Babylon from "@babylonjs/core/pure";
import type {BabylonRenderer} from "./babylon.js";
import type {Scene} from "./scene.js";
import type {Entity,View} from "./types.js";
import {lineGeometry,planeBounds} from "./geometry.js";
import {Math3D as M} from "./math.js";
import {BabylonTransitionUniforms,transitionUniformNames} from "./babylon-transition-uniforms.js";
export class BabylonPlane {
  private readonly transitionUniforms=new BabylonTransitionUniforms();
  private noiseKey="";private noiseRevision=0;private noisePending:Promise<void>=Promise.resolve();private noiseTexture?:Babylon.RawTexture;
  readonly id:string;readonly material:Babylon.ShaderMaterial;readonly mesh:Babylon.Mesh;
  constructor(readonly renderer:BabylonRenderer,node:Entity){
    this.id=node.id;const B=renderer.B;this.material=new B.ShaderMaterial(`${node.name} / PlaneRenderer`,renderer.scene,{vertex:"sceneEntity",fragment:"sceneSolid"},{attributes:["position","uv"],uniforms:["worldViewProjection","tint","ellipse","ellipseSize","ellipseAA","noiseOrigin","noiseSize","noiseRange","noiseEnabled","noiseChannelGain",...transitionUniformNames],samplers:["noiseTex"],defines:["#define PLANE_NOISE"],needAlphaBlending:true});this.material.backFaceCulling=false;this.material.disableDepthWrite=true;this.material.setTexture("noiseTex",renderer.neutralTexture);this.mesh=renderer.quad(node.name,node.id,this.material);
  }
  async update(scene:Scene,view:View):Promise<void>{
    const c=scene.requireComponent(this.id,"PlaneRenderer"),b=planeBounds(scene,this.id,view,c);this.mesh.setEnabled(c.enabled&&!!scene.active.get(this.id)&&!!b&&c.color.a>0);if(b)this.renderer.rect(this.mesh,b.left,b.bottom,b.right,b.top);this.renderer.tint(this.material,c.color);
    this.material.setFloat("ellipse",c.shape==="ellipse"?1:0);this.renderer.vec2(this.material,"ellipseSize",c.size);this.material.setFloat("ellipseAA",1/(view.pixelsPerUnit*Math.min(c.size.x,c.size.y)));
    const transition=scene.component(this.id,"Transition");
    this.transitionUniforms.update(this.renderer,this.material,transition,planeBounds(scene,this.id,view,c,0));
    const noise=scene.component(this.id,"ProceduralNoise"),r=this.renderer,m=this.material;
    r.vec2(m,"noiseOrigin",noise?.origin??{x:0,y:0});r.vec2(m,"noiseSize",noise?.worldSize??{x:1,y:1});m.setFloat("noiseRange",noise?.range??0);m.setFloat("noiseEnabled",noise?.enabled&&noise.bands.some(b=>b.variance>0)?1:0);m.setVector3("noiseChannelGain",new r.B.Vector3(noise?.channelGain.r??1,noise?.channelGain.g??1,noise?.channelGain.b??1));
    if(noise){const key=r.resources.noiseKey(noise);if(key!==this.noiseKey){this.noiseKey=key;const revision=++this.noiseRevision;
      this.noisePending=r.resources.noise(noise).then(pixels=>{if(revision!==this.noiseRevision)return;this.noiseTexture?.dispose();this.noiseTexture=r.texture(`${this.id}/noise`,pixels,{repeatX:true,repeatY:true});m.setTexture("noiseTex",this.noiseTexture);});
    }await this.noisePending;}
  }
  dispose():void{this.noiseRevision++;this.noiseTexture?.dispose();this.mesh.dispose();this.material.dispose();}
}
export class BabylonLine {
  readonly id:string;readonly layers:{mesh:Babylon.Mesh;material:Babylon.ShaderMaterial}[]=[];
  constructor(readonly renderer:BabylonRenderer,node:Entity){
    this.id=node.id;const B=renderer.B;
    for(let i=0;i<2;i++){const material=new B.ShaderMaterial(`${node.name} / ${i?"LineRenderer":"Glow"}`,renderer.scene,{vertex:"sceneEntity",fragment:"sceneLine"},{attributes:["position","uv"],uniforms:["worldViewProjection","tint","lineStart","lineEnd","halfWidth","sigma","gain","pixelWidth"],needAlphaBlending:true});material.backFaceCulling=false;material.disableDepthWrite=true;material.alphaMode=i?B.Engine.ALPHA_COMBINE:B.Engine.ALPHA_ADD;const mesh=renderer.quad(node.name,node.id,material);mesh.position.z=i?0:.0001;this.layers.push({mesh,material});}
  }
  async update(scene:Scene,view:View):Promise<void>{
    const c=scene.requireComponent(this.id,"LineRenderer"),shape=lineGeometry(scene,this.id,view,c),glow=scene.component(this.id,"Glow"),r=this.renderer;
    const world=scene.world.get(this.id)!,dx=M.point(world,{x:1,y:0,z:0},0),dy=M.point(world,{x:0,y:1,z:0},0),scale=Math.max(1e-6,Math.min(Math.hypot(dx.x,dx.y,dx.z),Math.hypot(dy.x,dy.y,dy.z)));
    for(let i=0;i<2;i++){
      const {mesh,material}=this.layers[i],isGlow=i===0;
      material.alphaMode=isGlow&&glow?.blend==="additive"?r.B.Engine.ALPHA_ADD:r.B.Engine.ALPHA_COMBINE;
      mesh.setEnabled(c.enabled&&!!scene.active.get(this.id)&&!!shape&&c.color.a>0&&(!isGlow||!!glow?.enabled));if(!shape)continue;
      const b=shape.bounds;r.rect(mesh,b.left,b.bottom,b.right,b.top);r.vec2(material,"lineStart",shape.start);r.vec2(material,"lineEnd",shape.end);material.setFloat("halfWidth",c.width/2);material.setFloat("pixelWidth",1/(view.pixelsPerUnit*view.dpr*scale));
      material.setFloat("sigma",isGlow?(glow?.sigmaWorld??0):0);material.setFloat("gain",isGlow&&glow?glow.intensity*Math.max(0,Math.min(1,(.2126*c.color.r+.7152*c.color.g+.0722*c.color.b-glow.threshold)/glow.softness)):1);r.tint(material,isGlow&&glow?{...glow.color,a:glow.color.a*c.color.a}:c.color);
    }
  }
  dispose():void{for(const l of this.layers){l.mesh.dispose();l.material.dispose();}}
}
