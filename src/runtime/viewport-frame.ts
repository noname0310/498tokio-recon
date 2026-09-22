import type {Rect,Vec2,View,ViewportFrame} from "./types.js";

export interface ViewportFrameLayout {width:number;height:number;aperture:Rect;radius:number;offset:Vec2}

/** Pixel layout shared by SVG and the shader. Camera translation/rotation cannot
 * move a screen border; only the current frustum size changes its opening. */
export function viewportFrameLayout(c:ViewportFrame,view:View):ViewportFrameLayout {
  const i=c.insetsWorld,u=view.pixelsPerUnit;
  const sx=Math.min(1,view.worldWidth/Math.max(i.left+i.right,Number.EPSILON));
  const sy=Math.min(1,view.worldHeight/Math.max(i.top+i.bottom,Number.EPSILON));
  const aperture={x:i.left*sx*u,y:i.top*sy*u,width:Math.max(0,view.width-(i.left+i.right)*sx*u),height:Math.max(0,view.height-(i.top+i.bottom)*sy*u)};
  return {width:view.width,height:view.height,aperture,radius:Math.min(c.radiusWorld*u,aperture.width/2,aperture.height/2),offset:{x:c.innerShadow.offsetWorld.x*u,y:-c.innerShadow.offsetWorld.y*u}};
}

export function roundedAperturePath(rect:Rect,r:number):string {
  const {x,y,width:w,height:h}=rect;
  if(w<=0||h<=0)return "";
  if(r===0)return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return `M${x+r} ${y}H${x+w-r}A${r} ${r} 0 0 1 ${x+w} ${y+r}V${y+h-r}A${r} ${r} 0 0 1 ${x+w-r} ${y+h}H${x+r}A${r} ${r} 0 0 1 ${x} ${y+h-r}V${y+r}A${r} ${r} 0 0 1 ${x+r} ${y}Z`;
}
