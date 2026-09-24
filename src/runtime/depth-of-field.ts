import type {Bounds,Matrix,Vec2,Vec3} from './types.js';
import type {Scene} from './scene.js';
import {Math3D as M} from './math.js';

// Fixed aperture rays bound the GPU quad and sample its color. DOM evaluates
// the same inverse-depth field with retained Gaussian layers.
export const apertureSamples:readonly Vec2[]=Array.from({length:49},(_,i)=>{
  if(i===0)return {x:0,y:0};
  const r=Math.sqrt(-2*Math.log((i-.5)/48)),a=i*2.399963229728653;
  return {x:r*Math.cos(a),y:r*Math.sin(a)};
});
export interface SpriteFocus {focus:number;maxSigmaWorld:number;apertureProjection:number;eye:Vec3;lensX:Vec3;lensY:Vec3;depth:Vec3;blurField:Vec3;bounds:Bounds;screenBounds:Bounds|null}
/** A plane homography embedded in X/Y/W, with an independent Z axis. */
function plane(x:Vec3,y:Vec3,w:Vec3):Matrix{return [x.x,y.x,0,w.x,x.y,y.y,0,w.y,0,0,1,0,x.z,y.z,0,w.z];}
export function spriteFocus(scene:Scene,id:string,bounds:Bounds):SpriteFocus|null {
  const c=scene.component(scene.cameraNode.id,'DepthOfField');
  if(!c?.enabled||c.apertureSigma===0||c.maxSigmaWorld===0||scene.requireComponent(scene.cameraNode.id,'Camera').projection!=='perspective')return null;
  const m=M.multiply(scene.viewMatrix,scene.world.get(id)!),inv=M.inverse(m),depth={x:m[2],y:m[6],z:m[14]};
  const corners=[{x:bounds.left,y:bounds.bottom},{x:bounds.right,y:bounds.bottom},{x:bounds.right,y:bounds.top},{x:bounds.left,y:bounds.top}];
  const depths=corners.map(p=>depth.x*p.x+depth.y*p.y+depth.z);
  const near=scene.requireComponent(scene.cameraNode.id,'Camera').near;
  if(Math.max(...depths)<=near)return null;
  if(Math.max(...depths.map(z=>scene.projectionDistance*c.apertureSigma*Math.abs(1/Math.max(near,z)-1/c.focusDistance)))<1e-5)return null;
  const eye={x:inv[12],y:inv[13],z:inv[14]},lensX=M.point(inv,{x:c.apertureSigma,y:0,z:0},0),lensY=M.point(inv,{x:0,y:c.apertureSigma,z:0},0);
  const x={x:m[0],y:m[4],z:m[12]},y={x:m[1],y:m[5],z:m[13]};
  // On a plane, inverse camera depth is affine in screen coordinates. DOM
  // blends a few Gaussian levels with this exact field after projection.
  const normal={x:m[1]*m[6]-m[2]*m[5],y:m[2]*m[4]-m[0]*m[6],z:m[0]*m[5]-m[1]*m[4]},d=normal.x*m[12]+normal.y*m[13]+normal.z*m[14];
  if(Math.abs(d)<1e-10)return null;
  const baseInverse=M.inverse(plane(x,y,depth));
  const o=scene.projectionOffset,blurField={x:c.apertureSigma*normal.x/d,y:-c.apertureSigma*normal.y/d,z:c.apertureSigma*(scene.projectionDistance*(normal.z/d-1/c.focusDistance)-(normal.x*o.x+normal.y*o.y)/d)};
  const out={...bounds};
  for(const sample of apertureSamples){
    const lx=sample.x*c.apertureSigma,ly=sample.y*c.apertureSigma;
    const warp=M.multiply(baseInverse,plane({x:x.x+lx*depth.x/c.focusDistance,y:x.y+lx*depth.y/c.focusDistance,z:x.z+lx*(depth.z/c.focusDistance-1)},{x:y.x+ly*depth.x/c.focusDistance,y:y.y+ly*depth.y/c.focusDistance,z:y.z+ly*(depth.z/c.focusDistance-1)},depth));
    for(const p of corners){const w=warp[3]*p.x+warp[7]*p.y+warp[15];if(Math.abs(w)<1e-8)continue;const q=M.point(warp,{...p,z:0});out.left=Math.min(out.left,q.x/w);out.right=Math.max(out.right,q.x/w);out.bottom=Math.min(out.bottom,q.y/w);out.top=Math.max(out.top,q.y/w);}
  }
  // Crossing the near plane can send the complete artwork's corner to
  // infinity. GPU/DOM frustum clipping handles it; don't expand to that pole.
  const drawBounds=Math.min(...depths)<=near?bounds:out;
  const projected=corners.map(p=>scene.projectCameraPoint(M.point(m,{...p,z:0}))),screenBounds=Math.min(...depths)<=near?null:{left:Math.min(...projected.map(p=>p.x)),right:Math.max(...projected.map(p=>p.x)),bottom:Math.min(...projected.map(p=>p.y)),top:Math.max(...projected.map(p=>p.y))};
  return {focus:c.focusDistance,maxSigmaWorld:c.maxSigmaWorld,apertureProjection:scene.projectionDistance*c.apertureSigma,eye,lensX,lensY,depth,blurField,bounds:drawBounds,screenBounds};
}
