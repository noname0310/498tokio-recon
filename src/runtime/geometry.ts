import type {Scene} from "./scene.js";
import type {Bounds,GridTransitionSettings,LineRenderer,PinwheelProfile,PinwheelTransitionSettings,PlaneRenderer,Transition,Vec2,View} from "./types.js";

export function pinwheelProfile(c:PinwheelTransitionSettings,progress:number):PinwheelProfile {
  const phase=Math.min(c.profiles.length-1,Math.floor(Math.max(0,progress)*(c.profiles.length-1)));
  return c.profiles[phase];
}
export function pinwheelFront(front:readonly number[],u:number):number {
  const last=front.length-1;
  return u<=last?front[u]:front[last]+(u-last)*Math.max(0,front[last]-front[last-1]);
}
export function pinwheelCovered(i:number,j:number,profile:PinwheelProfile):boolean {
  const q=i>=0?(j>=0?0:3):(j>=0?1:2);
  const u=q===0?i:q===1?j:q===2?-i-1:-j-1,v=q===0?j:q===1?-i-1:q===2?-j-1:i;
  return v<pinwheelFront(profile.fronts[q],u);
}
/** Geometry keys ignore motion inside a held pinwheel phase. */
export function transitionGeometryKey(c:Transition):string {
  if(c.kind==="grid")return JSON.stringify([c.kind,c.progress,c.grid]);
  if(c.kind==="stripes")return JSON.stringify([c.kind,c.progress,c.stripes]);
  if(c.kind==="dissolve")return JSON.stringify([c.kind,c.dissolve.direction.x||c.dissolve.direction.y?c.progress:Math.ceil(c.progress*4093-.5),c.dissolve]);
  return JSON.stringify([c.kind,c.pinwheel.cellSize,c.pinwheel.origin,pinwheelProfile(c.pinwheel,c.progress)]);
}

/** Every intermediate integer is exactly representable by a highp GPU float.
 * The same coordinate hash therefore produces identical SVG/shader cells,
 * independent of traversal order, seeking or expanded camera bounds. */
export function dissolveThreshold(x:number,y:number,seed:number):number {
  const mod=(n:number)=>((n%4093)+4093)%4093;
  x=mod(x);y=mod(y);seed=mod(seed);
  let n=mod(x*53+y*97+seed);n=mod(n*(n+1));
  n=mod(n*109+seed*37+x*17);n=mod(n*(n+1));
  return (mod(n*173+y*71+seed*13)+.5)/4093;
}

export function planeBounds(scene:Scene,id:string,view:View,c:PlaneRenderer,padding=.1):Bounds|null {
  const b=c.coverage==="camera"?scene.coverage(id,view,padding):{left:-c.size.x/2,right:c.size.x/2,bottom:-c.size.y/2,top:c.size.y/2};
  return clippedBounds(b,c.clipBounds);
}
export function clippedBounds(b:Bounds|null,clip:import("./types.js").ClipBounds|null):Bounds|null {
  if(!b||!clip)return b;
  const left=Math.max(b.left,clip.left??-Infinity),right=Math.min(b.right,clip.right??Infinity),bottom=Math.max(b.bottom,clip.bottom??-Infinity),top=Math.min(b.top,clip.top??Infinity);
  return left<right&&bottom<top?{left,right,bottom,top}:null;
}
export function gridTransitionFront(bounds:Bounds,c:GridTransitionSettings,progress:number):{direction:Vec2;front:number}{
  const length=Math.hypot(c.direction.x,c.direction.y),direction={x:c.direction.x/length,y:c.direction.y/length};
  const distances=[bounds.left,bounds.right].flatMap(x=>[bounds.bottom,bounds.top].map(y=>x*direction.x+y*direction.y));
  const lo=Math.min(...distances),hi=Math.max(...distances);
  return {direction,front:lo+Math.max(0,Math.min(1,progress))*(hi-lo+c.feather)};
}

/** Reused convex clip buffers for distance(cell, point) <= wave(point).
 * Intersect the original cell with four half-planes. This also handles narrow
 * feathers and diagonal directions without dividing by a corner scale pole.
 */
export class GridTransitionCell {
  private source=new Float64Array(24);
  private target=new Float64Array(24);
  vertices:Float64Array=this.source;
  count=0;
  completed(bounds:Bounds,direction:Vec2,limit:number):void {
    const s=this.source;
    s[0]=bounds.left;s[1]=bounds.bottom;s[2]=bounds.right;s[3]=bounds.bottom;
    s[4]=bounds.right;s[5]=bounds.top;s[6]=bounds.left;s[7]=bounds.top;
    this.count=clipHalfPlane(s,this.target,4,direction.x,direction.y,limit);this.vertices=this.target;
  }
  update(halfX:number,halfY:number,q:number,gradientX:number,gradientY:number):void {
    let source=this.source,target=this.target,count=4;
    for(let i=0;i<4;i++){source[i*2]=i===0||i===3?-halfX:halfX;source[i*2+1]=i<2?-halfY:halfY;}
    if(q-Math.abs(gradientX)*halfX-Math.abs(gradientY)*halfY>=1){this.vertices=source;this.count=4;return;}
    for(let edge=0;edge<4&&count;edge++){
      const nx=gradientX+(edge===0?1/halfX:edge===1?-1/halfX:0);
      const ny=gradientY+(edge===2?1/halfY:edge===3?-1/halfY:0);
      count=clipHalfPlane(source,target,count,nx,ny,q);
      const previous=source;source=target;target=previous;
    }
    this.vertices=source;this.count=count;
  }
}
function clipHalfPlane(source:Float64Array,target:Float64Array,count:number,nx:number,ny:number,limit:number):number {
  let next=0,ax=source[(count-1)*2],ay=source[(count-1)*2+1],da=limit-nx*ax-ny*ay;
  for(let i=0;i<count;i++){
    const bx=source[i*2],by=source[i*2+1],db=limit-nx*bx-ny*by;
    if((da>=0)!==(db>=0)){
      const t=da/(da-db);target[next++]=ax+(bx-ax)*t;target[next++]=ay+(by-ay)*t;
    }
    if(db>=0){target[next++]=bx;target[next++]=by;}
    ax=bx;ay=by;da=db;
  }
  return next/2;
}
export interface LineGeometry {start:Vec2;end:Vec2;bounds:Bounds}
export function lineGeometry(scene:Scene,id:string,view:View,c:LineRenderer):LineGeometry|null {
  let start=c.start,end=c.end;
  const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
  if(length<1e-12||c.width<=0)return null;
  const glow=scene.component(id,"Glow"),pad=c.width/2+(glow?.enabled?4*glow.sigmaWorld:0)+1/view.pixelsPerUnit;
  if(c.coverage!=="segment"){
    const coverage=scene.coverage(id,view,pad);if(!coverage)return null;
    const ux=dx/length,uy=dy/length,distances:number[]=[];
    for(const x of [coverage.left,coverage.right])for(const y of [coverage.bottom,coverage.top])distances.push((x-start.x)*ux+(y-start.y)*uy);
    // A ray retains its authored origin and direction while its positive end
    // covers the current finite frustum. No arbitrary world-length ceiling.
    const lo=c.coverage==="ray"?0:Math.min(...distances)-pad,hi=Math.max(...distances)+pad;
    if(hi<=lo)return null;
    end={x:start.x+hi*ux,y:start.y+hi*uy};start={x:start.x+lo*ux,y:start.y+lo*uy};
  }
  return {start,end,bounds:{left:Math.min(start.x,end.x)-pad,right:Math.max(start.x,end.x)+pad,bottom:Math.min(start.y,end.y)-pad,top:Math.max(start.y,end.y)+pad}};
}
