import type { Rect, SpriteAsset } from "./types.js";

/** Content bounds in texels; padding belongs to storage, never to the sprite's size or pivot. */
export function spriteRect(asset:SpriteAsset,frame:number):Rect {
  const atlas=asset.atlas;
  if(!atlas)return {x:0,y:0,width:asset.size.x,height:asset.size.y};
  const {cellSize,columns}=atlas,padding=atlas.padding??0;
  return {x:(frame%columns)*(cellSize.x+2*padding)+padding,
    y:Math.floor(frame/columns)*(cellSize.y+2*padding)+padding,width:cellSize.x,height:cellSize.y};
}
