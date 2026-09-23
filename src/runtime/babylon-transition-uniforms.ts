import type {ShaderMaterial} from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {Bounds,ComponentMap} from "./types.js";
import {gridTransitionFront,pinwheelFront,pinwheelProfile} from "./geometry.js";

export const transitionUniformNames=["gridSize","gridOrigin","gridDirection","gridFront","gridFeather","transitionKind","transitionProgress","pinwheelFronts","dissolveSeed"];
export class BabylonTransitionUniforms {
  private readonly fronts:number[]=Array<number>(64).fill(0);
  update(r:BabylonSceneContext,m:ShaderMaterial,c:ComponentMap["Transition"]|undefined,bounds:Bounds|null):void {
    m.setFloat("transitionKind",c?.enabled===false||!c?0:c.kind==="grid"?1:c.kind==="pinwheel"?2:c.kind==="dissolve"?3:4);
    m.setFloat("transitionProgress",c?.progress??1);
    if(!c||!bounds)return;
    if(c.kind==="grid"){
      const g=c.grid,{direction,front}=gridTransitionFront(bounds,g,c.progress);
      r.vec2(m,"gridSize",g.cellSize);r.vec2(m,"gridOrigin",g.origin);r.vec2(m,"gridDirection",direction);
      m.setFloat("gridFront",front);m.setFloat("gridFeather",g.feather);
    }else if(c.kind==="dissolve"){
      r.vec2(m,"gridSize",c.dissolve.cellSize);r.vec2(m,"gridOrigin",c.dissolve.origin);m.setFloat("dissolveSeed",((c.dissolve.seed%4093)+4093)%4093);
      const sweep=c.dissolve.direction.x||c.dissolve.direction.y?gridTransitionFront(bounds,c.dissolve,c.progress):null;r.vec2(m,"gridDirection",sweep?.direction??{x:0,y:0});m.setFloat("gridFront",sweep?.front??0);m.setFloat("gridFeather",c.dissolve.feather);
    }else if(c.kind==="stripes"){
      r.vec2(m,"gridDirection",c.stripes.axis==="x"?{x:1,y:0}:{x:0,y:1});m.setFloat("gridFeather",c.stripes.period);m.setFloat("gridFront",c.stripes.phase);
    }else{
      const p=c.pinwheel,profile=pinwheelProfile(p,c.progress);
      r.vec2(m,"gridSize",p.cellSize);r.vec2(m,"gridOrigin",p.origin);
      for(let q=0;q<4;q++)for(let u=0;u<16;u++)this.fronts[q*16+u]=pinwheelFront(profile.fronts[q],u);
      m.setFloats("pinwheelFronts",this.fronts);
    }
  }
}
