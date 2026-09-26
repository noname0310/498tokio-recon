import type {Scene} from "./scene.js";
import type {Bounds,ComponentMap,Matrix,View,Vec2} from "./types.js";
import {Math3D as M} from "./math.js";

export interface TransitionGroup {
  id:string;component:ComponentMap["Transition"];members:Set<string>;depth:number;
  bounds:Bounds|null;frameBounds:Bounds|null;viewMatrix:Matrix;
  blurUV:Vec2;
}

/** Scene subtrees are compositing units, independent of the renderer hierarchy.
 * Their internal world transforms/depths remain unchanged. A controller's depth
 * positions the completed group among the other scene surfaces.
 */
export function transitionGroups(scene:Scene,view:View):TransitionGroup[]{
  const inverseCamera=M.inverse(scene.world.get(scene.cameraNode.id)!),groups:TransitionGroup[]=[],owners=new Set<string>();
  for(const node of scene.nodes.values()){
    const c=scene.component(node.id,"Transition");
    if(!c?.target||!scene.active.get(node.id)||!scene.active.get(c.target.entity))continue;
    const members=new Set<string>();
    for(const id of scene.nodes.keys()){
      let ancestor:string|undefined=id;
      while(ancestor){if(ancestor===c.target.entity){if(owners.has(id))throw new Error("Active Transition target subtrees must not overlap.");members.add(id);owners.add(id);break;}ancestor=scene.parents.get(ancestor)?.id;}
    }
    const viewMatrix=M.multiply(inverseCamera,scene.world.get(node.id)!);
    const blur=scene.component(node.id,"GaussianBlur"),sigma=blur?.enabled?blur.sigmaWorld:{x:0,y:0};
    groups.push({id:node.id,component:c,members,depth:viewMatrix[14],viewMatrix,bounds:scene.coverage(node.id,view,.1),frameBounds:scene.coverage(node.id,view,0),blurUV:{x:sigma.x/view.worldWidth,y:sigma.y/view.worldHeight}});
  }
  return groups.sort((a,b)=>b.depth-a.depth||a.id.localeCompare(b.id));
}
