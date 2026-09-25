import type * as Babylon from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {TransitionGroup} from "./transitions.js";
import {Math3D as M} from "./math.js";
import {BabylonTransitionUniforms,transitionUniformNames} from "./babylon-transition-uniforms.js";
import {BabylonFade} from "./babylon-fade.js";
interface MaskGroup {mesh:Babylon.Mesh;material:Babylon.ShaderMaterial;uniforms:BabylonTransitionUniforms}

export function createTransitionMask(r:BabylonSceneContext,id:string):MaskGroup {
  const B=r.B,material=new B.ShaderMaterial(`${id}/stencil`,r.scene,{vertex:"sceneEntity",fragment:"sceneSolid"},{attributes:["position","uv"],uniforms:["worldViewProjection","tint",...transitionUniformNames],needAlphaBlending:true});
  material.backFaceCulling=false;material.disableDepthWrite=true;material.disableColorWrite=true;material.depthFunction=B.Engine.ALWAYS;
  material.stencil.enabled=true;material.stencil.func=B.Engine.ALWAYS;material.stencil.funcRef=1;material.stencil.opStencilDepthPass=B.Engine.REPLACE;
  material.stencil.opStencilFail=B.Engine.KEEP;material.stencil.opDepthFail=B.Engine.KEEP;
  return {mesh:r.quad(`${id}/stencil`,id,material),material,uniforms:new BabylonTransitionUniforms()};
}

export class BabylonTransitions {
  private readonly groups=new Map<string,MaskGroup>();
  private readonly fades=new Map<string,BabylonFade>();
  private fadeDraws:{fade:BabylonFade;opacity:number;members:Babylon.AbstractMesh[]}[]=[];
  private applied=false;
  constructor(private readonly renderer:BabylonSceneContext){}
  update(groups:TransitionGroup[]):void {
    if(!groups.length&&!this.applied)return;
    this.applied=groups.length>0;
    const r=this.renderer,B=r.B,owners=new Map<string,number>(),masks=new Set<Babylon.AbstractMesh>();
    this.fadeDraws=[];
    B.RenderingManager.MAX_RENDERINGGROUPS=Math.max(B.RenderingManager.MAX_RENDERINGGROUPS,groups.length*3+1);
    groups.forEach((group,index)=>{
      if(group.component.kind==="fade"){
        let fade=this.fades.get(group.id);if(!fade){fade=new BabylonFade(r,group.id);this.fades.set(group.id,fade);}
        fade.mesh.renderingGroupId=index*3+2;fade.mesh.setEnabled(false);
        const world=r.data.world.get(group.id)!;fade.mesh.metadata={sortWorldPosition:{x:world[12],y:world[13],z:world[14]}};
        const opacity=group.component.enabled?group.component.progress:1;
        if(opacity<1)this.fadeDraws.push({fade,opacity,members:[]});else fade.release();
        r.scene.setRenderingAutoClearDepthStencil(index*3+2,true,true,true);
        r.scene.setRenderingAutoClearDepthStencil(index*3+3,true,true,true);
        for(const id of group.members)owners.set(id,index);
        return;
      }
      let record=this.groups.get(group.id);
      if(!record){
        record=createTransitionMask(r,group.id);this.groups.set(group.id,record);
      }
      const {mesh,material}=record,{component:c,bounds,frameBounds}=group,masked=c.enabled&&c.progress<1;
      mesh.renderingGroupId=index*3+1;mesh.setEnabled(masked&&!!bounds&&!!frameBounds);
      if(bounds&&frameBounds){
        r.rect(mesh,bounds.left,bounds.bottom,bounds.right,bounds.top);
        record.uniforms.update(r,material,c,frameBounds);r.tint(material,{r:1,g:1,b:1,a:1});
      }
      // Preserve the stencil between its writer and all incoming materials.
      // Each later compositing unit gets a fresh depth/stencil buffer, not color.
      r.scene.setRenderingAutoClearDepthStencil(index*3+1,true,true,true);
      r.scene.setRenderingAutoClearDepthStencil(index*3+2,!masked,true,false);
      r.scene.setRenderingAutoClearDepthStencil(index*3+3,true,true,true);
      for(const id of group.members)owners.set(id,index);
    });
    const active=new Set(groups.map(g=>g.id));
    for(const [id,record] of this.groups){masks.add(record.mesh);if(!active.has(id))record.mesh.setEnabled(false);}
    for(const [id,fade] of this.fades){masks.add(fade.mesh);if(!active.has(id))fade.release();}
    const view=M.inverse(r.data.world.get(r.data.cameraNode.id)!);
    for(const mesh of r.scene.meshes){
      if(masks.has(mesh)||!mesh.material)continue;
      const owner=r.entityOwners.get(mesh),index=owner===undefined?undefined:owners.get(owner),stencil=mesh.material.stencil;
      if(index!==undefined){
        const c=groups[index].component;mesh.renderingGroupId=index*3+2;
        stencil.enabled=c.kind!=="fade"&&c.enabled&&c.progress<1;stencil.func=B.Engine.EQUAL;stencil.funcRef=1;stencil.mask=0;
        if(c.kind==="fade"){const draw=this.fadeDraws.find(d=>d.fade===this.fades.get(groups[index].id));if(draw)draw.members.push(mesh);}
        stencil.opStencilFail=stencil.opDepthFail=stencil.opStencilDepthPass=B.Engine.KEEP;
      }else{
        stencil.enabled=false;mesh.computeWorldMatrix(true);
        const depth=M.point(view,mesh.getBoundingInfo().boundingSphere.centerWorld).z;
        mesh.renderingGroupId=groups.filter(g=>g.depth>depth).length*3;
      }
    }
  }
  render(drawScene:()=>void):void {
    if(!this.fadeDraws.length){drawScene();return;}
    const hidden:Babylon.AbstractMesh[]=[];
    try{
      for(const draw of this.fadeDraws){
        const visible=draw.members.filter(mesh=>mesh.isVisible&&mesh.isEnabled());
        if(draw.opacity>0)draw.fade.capture(visible,draw.opacity);
        for(const mesh of visible){hidden.push(mesh);mesh.isVisible=false;}
      }
      drawScene();
    }finally{for(const mesh of hidden)mesh.isVisible=true;}
  }
  dispose():void {for(const record of this.groups.values()){record.mesh.dispose();record.material.dispose();}for(const fade of this.fades.values())fade.dispose();this.fades.clear();this.fadeDraws=[];this.groups.clear();this.applied=false;}
}
