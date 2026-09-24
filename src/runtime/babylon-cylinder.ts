import type * as Babylon from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {Scene} from "./scene.js";
import type {CylindricalSpriteRenderer,Entity,View} from "./types.js";
import {cylinderGeometryKey,cylinderStrips} from "./cylinder.js";
import {Math3D as M} from "./math.js";
export class BabylonCylinder {
  readonly id:string;readonly mesh:Babylon.Mesh;readonly material:Babylon.ShaderMaterial;
  private geometryKey="";private sourceKey="";private texture?:Babylon.RawTexture;private revision=0;
  constructor(readonly renderer:BabylonSceneContext,node:Entity){
    this.id=node.id;const B=renderer.B;
    this.material=new B.ShaderMaterial(`${node.name} / CylindricalSpriteRenderer`,renderer.scene,{vertex:"sceneCylinder",fragment:"sceneCylinder"},{attributes:["position","uv","normal"],uniforms:["worldViewProjection","uvOffset","tint","lightDirection","ambient","diffuse"],samplers:["spriteTex"],needAlphaBlending:true});
    this.material.backFaceCulling=false;this.material.disableDepthWrite=true;this.material.setTexture("spriteTex",renderer.neutralTexture);
    this.mesh=new B.Mesh(node.name,renderer.scene);this.mesh.parent=renderer.nodes.get(node.id)||null;this.mesh.material=this.material;this.mesh.alwaysSelectAsActiveMesh=true;renderer.entityOwners.set(this.mesh,node.id);
    this.geometry(node.components.find(c=>c.type==="CylindricalSpriteRenderer")!);
  }
  private geometry(c:CylindricalSpriteRenderer):void{
    const key=cylinderGeometryKey(c);if(key===this.geometryKey)return;this.geometryKey=key;
    const position:number[]=[],uv:number[]=[],normal:number[]=[],indices:number[]=[];const span=c.length.max-c.length.min;
    for(const [i,s]of cylinderStrips(c).entries()){
      for(const [x,y]of [[0,0],[s.width,0],[s.width,-span],[0,-span]]){const p=M.point(s.matrix,{x,y,z:0});position.push(p.x,p.y,p.z);normal.push(s.normal.x,s.normal.y,0);uv.push(s.u+x/s.width/c.segments,-p.z/c.tileLength);}
      const base=i*4;indices.push(base,base+1,base+2,base,base+2,base+3);
    }
    const B=this.renderer.B;this.mesh.setVerticesData(B.VertexBuffer.PositionKind,position);this.mesh.setVerticesData(B.VertexBuffer.UVKind,uv);this.mesh.setVerticesData(B.VertexBuffer.NormalKind,normal);this.mesh.setIndices(indices);
  }
  async update(scene:Scene,_view:View):Promise<void>{
    const revision=++this.revision,r=this.renderer,c=scene.requireComponent(this.id,"CylindricalSpriteRenderer");
    const visible=c.enabled&&!!scene.active.get(this.id)&&c.color.a>0&&r.resources.isImageReady(c.asset);this.mesh.setEnabled(visible);if(!visible)return;
    this.geometry(c);r.tint(this.material,c.color);r.vec2(this.material,"uvOffset",c.uvOffset);this.material.setFloat("ambient",c.lighting.ambient);this.material.setFloat("diffuse",c.lighting.diffuse);
    const d=c.lighting.direction;this.material.setVector3("lightDirection",new r.B.Vector3(d.x,d.y,d.z).normalize());
    const source=scene.source(c.asset);if(this.sourceKey!==source){
      const pixels=await r.resources.image(scene,c.asset);if(revision!==this.revision)return;
      this.texture?.dispose();this.texture=r.texture(`${this.id}/tile`,pixels,{repeatX:true,repeatY:true,linear:scene.asset(c.asset).filter==="linear"});this.material.setTexture("spriteTex",this.texture);this.sourceKey=source;
    }
  }
  dispose():void{this.revision++;this.texture?.dispose();this.mesh.dispose();this.material.dispose();}
}
