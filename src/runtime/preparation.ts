import type {Scene} from "./scene.js";
import type {ComponentMap,ComponentType,Entity,ProceduralNoise} from "./types.js";
import {readProperty,writeProperty} from "./animation/sequence.js";

/** Enumerate immutable resource recipes, never transforms or live timeline
 * samples. A bounded Cartesian superset also covers nested/blended bindings. */
export function componentVariants<K extends ComponentType>(scene:Scene,node:Entity,type:K,paths:readonly string[]):ComponentMap[K][] {
  const base=node.components.find(c=>c.type===type) as ComponentMap[K]|undefined;if(!base)return [];
  let variants=[base];
  for(const path of paths){
    const tokens=path.split("."),initial=readProperty(base,tokens);
    if(typeof initial!=="number"&&typeof initial!=="boolean")continue;
    const values=scene.sequence?.propertyValues(node.id,{component:type,path},initial);
    if(!values||values.length===1||values.length*variants.length>256)continue;
    variants=variants.flatMap(c=>values.map(value=>{const copy=structuredClone(c);writeProperty(copy,tokens,value);return copy;}));
  }
  return variants;
}

/** CPU generation and GPU upload must enumerate the same immutable fields. */
export function noiseVariants(scene:Scene,node:Entity):ProceduralNoise[] {
  const noise=node.components.find(c=>c.type==="ProceduralNoise");if(!noise)return [];
  return componentVariants(scene,node,"ProceduralNoise",["seed","textureSize.x","textureSize.y","range",...noise.bands.flatMap((_,i)=>[`bands.${i}.variance`,`bands.${i}.sigmaTexels.x`,`bands.${i}.sigmaTexels.y`])]);
}

/** Yield a bounded batch during background preparation so playback/UI remain live. */
export function preparationYield():()=>Promise<void> {
  let deadline=performance.now()+4;
  return async()=>{if(performance.now()<deadline)return;await new Promise<void>(resolve=>setTimeout(resolve,0));deadline=performance.now()+4;};
}
