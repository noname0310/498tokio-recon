import type {CylindricalSpriteRenderer,Matrix,Vec3} from "./types.js";
export interface CylinderStrip {matrix:Matrix;normal:Vec3;width:number;u:number}
export function cylinderGeometryKey(c:CylindricalSpriteRenderer):string{return `${c.radius}/${c.length.min}/${c.length.max}/${c.segments}/${c.tileLength}`;}
/** Retained planar facets used identically by CSS and the GPU mesh. */
export function cylinderStrips(c:CylindricalSpriteRenderer):CylinderStrip[]{
  return Array.from({length:c.segments},(_,i)=>{
    const a=i*2*Math.PI/c.segments,b=(i+1)*2*Math.PI/c.segments;
    const x=c.radius*Math.cos(a),y=-c.radius*Math.sin(a),dx=c.radius*Math.cos(b)-x,dy=-c.radius*Math.sin(b)-y,width=Math.hypot(dx,dy);
    const normal={x:Math.cos((a+b)/2),y:-Math.sin((a+b)/2),z:0};
    return {u:i/c.segments,width,normal,matrix:[dx/width,dy/width,0,0, 0,0,-1,0, normal.x,normal.y,0,0, x,y,c.length.min,1]};
  });
}
export function cylinderLight(c:CylindricalSpriteRenderer,n:Vec3):number{
  const d=c.lighting.direction,length=Math.hypot(d.x,d.y,d.z);
  return c.lighting.ambient+c.lighting.diffuse*Math.max(0,(n.x*d.x+n.y*d.y+n.z*d.z)/length);
}
