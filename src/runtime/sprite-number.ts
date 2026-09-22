import type {Bounds,SpriteAsset,SpriteNumberRenderer} from "./types.js";

export interface NumberLayout {text:string;frames:number[];starts:number[];width:number;height:number;left:number;bounds:Bounds}
export function numberLayout(c:SpriteNumberRenderer,asset:SpriteAsset):NumberLayout {
  const integer=Math[c.rounding](c.value),text=(integer<0?"-":"")+String(Math.abs(integer)).padStart(c.minDigits,"0")+c.suffix;
  const cell=asset.atlas?.cellSize??asset.size,frames:number[]=[],starts:number[]=[];
  let advance=0,width=0;
  for(const ch of text){const frame=c.glyphs.indexOf(ch);if(frame<0)throw new Error(`Missing numeric glyph: ${ch}`);frames.push(frame);starts.push(advance);width=advance+cell.x;advance+=c.advances[frame]??cell.x;}
  const left=c.alignment==="left"?0:c.alignment==="center"?-width/2:-width,u=asset.pixelsPerUnit;
  return {text,frames,starts,width,height:cell.y,left,bounds:{left:left/u,right:(left+width)/u,top:0,bottom:-cell.y/u}};
}
