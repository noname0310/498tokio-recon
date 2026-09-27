import type {ComponentMap,Rect,SpriteAsset,Vec2} from "./types.js";

export interface TileTextureRecipe {
  slot:"background"|"halo"|"shadow";
  key:string;
  sigmaWorld:Vec2;
  resolution:number;
}

/** The same immutable filter recipe drives startup preparation and live draws. */
export function tileTextureRecipes(source:string,asset:SpriteAsset,rect:Rect,component:ComponentMap["TiledSpriteRenderer"],texturePixelsPerUnit:number,
  blur?:ComponentMap["GaussianBlur"],glow?:ComponentMap["Glow"],shadow?:ComponentMap["DropShadow"]):TileTextureRecipe[] {
  const resolution=Math.max(texturePixelsPerUnit,asset.pixelsPerUnit*(component.clipBounds?8:blur?.enabled?2:0));
  const sigma=blur?.enabled?blur.sigmaWorld:{x:0,y:0},result:TileTextureRecipe[]=[];
  const add=(slot:TileTextureRecipe["slot"],sigmaWorld:Vec2,resolution:number)=>{
    const key=(slot==="halo"?"tile-halo:":"tile:")+JSON.stringify([source,rect,asset,sigmaWorld,resolution,component.wrap.y]);
    result.push({slot,key,sigmaWorld,resolution});
  };
  if(sigma.x>0||sigma.y>0)add("background",sigma,resolution);
  const filterResolution=Math.min(resolution,Math.max(texturePixelsPerUnit,asset.pixelsPerUnit*2));
  if(glow?.enabled&&glow.sigmaWorld>0)add("halo",{x:Math.hypot(sigma.x,glow.sigmaWorld),y:Math.hypot(sigma.y,glow.sigmaWorld)},filterResolution);
  if(shadow?.enabled)add("shadow",{x:Math.hypot(sigma.x,shadow.sigmaWorld),y:Math.hypot(sigma.y,shadow.sigmaWorld)},filterResolution);
  return result;
}
