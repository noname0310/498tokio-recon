import type {ComponentMap,MaskParameters,SpriteAsset} from "./types.js";

export function spriteMaskRecipe(source:string,asset:SpriteAsset,frame:number,c:ComponentMap["Glow"|"DropShadow"],resolution:number){
  const parameters:MaskParameters=c.type==="DropShadow"?{type:"DropShadow",sigmaWorld:c.sigmaWorld}:{type:"Glow",sigmaWorld:c.sigmaWorld,threshold:c.threshold,softness:c.softness};
  const key=JSON.stringify([source,asset,frame,parameters,resolution]);
  return {key,jobKey:"mask:"+key,parameters};
}
