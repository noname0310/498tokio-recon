import type {Scene} from "./scene.js";
import type {Resources} from "./resources.js";
import type {Bounds,Matrix,PixelImage,Vec2,Vec3,View} from "./types.js";
import {Math3D as M} from "./math.js";

interface OpaqueSprite {bounds:Bounds[];integral:Int32Array;width:number;height:number;origin:Vec2;pixelsPerUnit:number}
interface Occluder {id:string;inverse:Matrix;side:number;eye:Vec3;bounds:Bounds[]|null;mask?:OpaqueSprite}
/** Opaque tiled planes are depth writers in Babylon. The flat DOM graph clips
 * transparent surfaces against their camera rays before composition. */
export class DOMPlanarDepth {
  readonly opaque=new Set<string>();
  private planes:Occluder[]=[];
  private revision=0;
  private readonly opacity=new WeakMap<PixelImage,boolean>();
  private readonly spriteBounds=new WeakMap<PixelImage,Map<string,OpaqueSprite>>();
  async update(scene:Scene,resources:Resources):Promise<void> {
    const revision=++this.revision;
    this.opaque.clear();this.planes=[];
    if(scene.requireComponent(scene.cameraNode.id,"Camera").projection!=="perspective")return;
    // Stencil groups have separate depth buffers; do not cross those groups.
    if([...scene.nodes.keys()].some(id=>{const c=scene.component(id,"Transition");return scene.isActive(id)&&c?.enabled&&c.progress<1;}))return;
    const candidates=[...scene.nodes.keys()].filter(id=>{
      const c=scene.component(id,"TiledSpriteRenderer");
      const blur=scene.component(id,"GaussianBlur"),glow=scene.component(id,"Glow");
      const softCrop=c?.clipBounds&&(blur?.enabled&&(blur.sigmaWorld.x>0||blur.sigmaWorld.y>0)||glow?.enabled&&glow.sigmaWorld>0);
      return scene.isActive(id)&&c?.enabled&&c.color.a===1&&!softCrop&&(c.wrap.y==="repeat"||c.wrap.y==="clamp")&&resources.isImageReady(c.asset);
    });
    const cameraWorld=scene.world.get(scene.cameraNode.id)!,camera=scene.requireComponent(scene.cameraNode.id,"Camera");
    const planes:(Occluder|null)[]=await Promise.all(candidates.map(async id=>{
      const c=scene.requireComponent(id,"TiledSpriteRenderer"),world=scene.world.get(id)!,pixels=await resources.image(scene,c.asset);
      let opaque=this.opacity.get(pixels);
      if(opaque===undefined){opaque=true;for(let i=3;i<pixels.data.length;i+=4)if(pixels.data[i]!==255){opaque=false;break;}this.opacity.set(pixels,opaque);}
      if(!opaque)return null;
      const inverse=M.inverse(world),relative=M.multiply(inverse,cameraWorld),side=Math.sign(relative[14]);
      // A plane crossing the near clip cannot be represented by one visible
      // half-space. Keep regular sorting for that degenerate configuration.
      const radius=Math.hypot(relative[2],relative[6],relative[10])*camera.near;
      if(!side||Math.abs(relative[14])<=radius)return null;
      const b=c.clipBounds;
      return {id,inverse,side,eye:{x:relative[12],y:relative[13],z:relative[14]},bounds:b?[{left:b.left??-1e12,right:b.right??1e12,bottom:b.bottom??-1e12,top:b.top??1e12}]:null};
    }));
    for(const id of scene.nodes.keys()){
      const c=scene.component(id,"SpriteRenderer");
      if(!scene.isActive(id)||!c?.enabled||!c.depthWrite||c.color.a<1||!resources.isImageReady(c.asset))continue;
      const state=scene.spriteState(id);if(!state.visible)continue;
      const image=await resources.image(scene,c.asset),asset=scene.asset(c.asset),rect=state.rect;
      let cached=this.spriteBounds.get(image);if(!cached){cached=new Map();this.spriteBounds.set(image,cached);}
      const key=JSON.stringify([rect,asset.pivot,asset.pixelsPerUnit]);let mask=cached.get(key);
      if(!mask){
        const bounds:Bounds[]=[],integral=new Int32Array((rect.width+1)*(rect.height+1));let previous=new Map<string,Bounds>();
        for(let y=0;y<rect.height;y++){
          const next=new Map<string,Bounds>();let x=0;
          let sum=0;for(let col=0;col<rect.width;col++){sum+=Number(image.data[((rect.y+y)*image.width+rect.x+col)*4+3]>=128);integral[(y+1)*(rect.width+1)+col+1]=integral[y*(rect.width+1)+col+1]+sum;}
          while(x<rect.width){
            const solid=(at:number)=>image.data[((rect.y+y)*image.width+rect.x+at)*4+3]>=128;
            if(!solid(x)){x++;continue;}const start=x;while(x<rect.width&&solid(x))x++;
            const run=`${start}:${x}`,old=previous.get(run),ppu=asset.pixelsPerUnit;
            if(old){old.bottom=((1-asset.pivot.y)*rect.height-y-1)/ppu;next.set(run,old);}
            else{const b={left:(start-asset.pivot.x*rect.width)/ppu,right:(x-asset.pivot.x*rect.width)/ppu,bottom:((1-asset.pivot.y)*rect.height-y-1)/ppu,top:((1-asset.pivot.y)*rect.height-y)/ppu};bounds.push(b);next.set(run,b);}
          }
          previous=next;
        }
        mask={bounds,integral,width:rect.width,height:rect.height,origin:{x:-asset.pivot.x*rect.width/asset.pixelsPerUnit,y:(1-asset.pivot.y)*rect.height/asset.pixelsPerUnit},pixelsPerUnit:asset.pixelsPerUnit};cached.set(key,mask);
      }
      const inverse=M.inverse(scene.world.get(id)!),relative=M.multiply(inverse,cameraWorld),side=Math.sign(relative[14]);
      if(!side||Math.abs(relative[14])<=Math.hypot(relative[2],relative[6],relative[10])*camera.near)continue;
      const eye={x:relative[12],y:relative[13],z:relative[14]};
      planes.push({id,inverse,side,eye,bounds:mask.bounds,mask});
    }
    if(revision!==this.revision)return;
    this.planes=planes.filter((p):p is Occluder=>p!==null);
    for(const p of this.planes)this.opaque.add(p.id);
  }
  get enabled():boolean{return this.planes.length>0;}
  clipPoints(points:Vec3[],world:Matrix,id:string,offsetZ=0):{points:Vec3[];changed:boolean} {
    let changed=false,polygons=[points];
    for(const plane of this.planes){
      if(plane.id===id)continue;
      const m=M.multiply(plane.inverse,world),a=m[2]*plane.side,b=m[6]*plane.side,d=(m[10]*offsetZ+m[14])*plane.side;
      const front=(p:Vec3)=>a*p.x+b*p.y+d;
      if(polygons.every(polygon=>polygon.every(p=>front(p)>=-1e-9)))continue;
      if(plane.mask){
        polygons=polygons.flatMap(polygon=>{
          if(polygon.every(p=>front(p)>=-1e-9))return [polygon];
          const rear=clip(polygon,p=>-front(p));
          if(!coveredBySprite(rear,m,plane.eye,offsetZ,plane.mask!))return [polygon];
          changed=true;const visible=clip(polygon,front);return visible.length>=3?[visible]:[];
        });
        if(!polygons.length)break;
        if(polygons.every(polygon=>polygon.every(p=>front(p)>=-1e-9)))continue;
      }
      // All alpha rectangles share one transform and one intersection plane.
      // Front-facing smoke skips the entire hull silhouette in a single test.
      for(const bounds of plane.bounds??[null]){
      const next:Vec3[][]=[];
      for(const polygon of polygons){
        if(polygon.every(p=>front(p)>=-1e-9)){next.push(polygon);continue;}
        if(!bounds){changed=true;const visible=clip(polygon,front);if(visible.length>=3)next.push(visible);continue;}
        const eye=plane.eye;
        // Intersect the eye-to-surface ray with occluder Z=0. Once a point is
        // behind the plane, the denominator has the eye's sign, so each finite
        // edge becomes a linear half-space in the surface's own coordinates.
        const shadow=(p:Vec3)=>{
          const q=M.point(m,{x:p.x,y:p.y,z:offsetZ});
          const denominator=(eye.z-q.z)*plane.side;
          return {x:(eye.z*q.x-q.z*eye.x)*plane.side,y:(eye.z*q.y-q.z*eye.y)*plane.side,denominator};
        };
        const cuts=[(p:Vec3)=>-front(p),
          (p:Vec3)=>{const q=shadow(p);return q.x-bounds.left*q.denominator;},
          (p:Vec3)=>{const q=shadow(p);return bounds.right*q.denominator-q.x;},
          (p:Vec3)=>{const q=shadow(p);return q.y-bounds.bottom*q.denominator;},
          (p:Vec3)=>{const q=shadow(p);return bounds.top*q.denominator-q.y;}];
        let covered=polygon;
        for(const distance of cuts){covered=clip(covered,distance);if(covered.length<3)break;}
        if(covered.length<3){next.push(polygon);continue;}
        changed=true;let remaining=polygon;
        // The complement of a convex shadow can have several pieces. Retain
        // each piece; flattening them to a convex hull would fill the cutout.
        for(const distance of cuts){const outside=clip(remaining,p=>-distance(p));if(outside.length>=3)next.push(outside);remaining=clip(remaining,distance);if(remaining.length<3)break;}
      }
      polygons=next;if(!polygons.length)break;
      }
      if(!polygons.length)break;
    }
    // Doubled bridges have zero area, allowing CSS polygon() to encode several
    // disjoint, consistently wound contours without new SVG/DOM objects.
    const joined:Vec3[]=[];
    for(const polygon of polygons){if(joined.length)joined.push(joined[0],polygon[0]);joined.push(...polygon,polygon[0]);}
    if(joined.length)joined.push(joined[0]);
    return {points:changed?joined:points,changed};
  }
  clipPlane(scene:Scene,id:string,view:View,bounds:Bounds,offsetZ=0,origin:Vec2={x:0,y:0},units=view.pixelsPerUnit,screenSpace=false):{visible:boolean;css:string} {
    if(!screenSpace&&(!this.enabled||this.opaque.has(id)))return scene.clipPlane(id,view,bounds,offsetZ,origin,units);
    const world=scene.world.get(id)!,relative=M.multiply(scene.viewMatrix,world),camera=scene.requireComponent(scene.cameraNode.id,"Camera");
    let points=[[bounds.left,bounds.bottom],[bounds.right,bounds.bottom],[bounds.right,bounds.top],[bounds.left,bounds.top]].map(([x,y])=>({x,y,z:M.point(relative,{x,y,z:offsetZ}).z}));
    let changed=false;
    for(const [limit,sign]of [[camera.near,1],[camera.far,-1]])if(points.some(p=>(p.z-limit)*sign<0)){changed=true;points=clip(points,p=>(p.z-limit)*sign);}
    if(this.enabled&&!this.opaque.has(id)){const clipped=this.clipPoints(points,world,id,offsetZ);points=clipped.points;changed||=clipped.changed;}
    if(screenSpace&&changed){
      // A near/far clip on a long perspective plane can create an enormous
      // local raster mask. Its projection is the same polygon, bounded by
      // the viewport. Apply that small mask outside the transformed surface.
      points=points.map(p=>{const q=scene.projectCameraPoint(M.point(relative,{x:p.x,y:p.y,z:offsetZ}));return {x:q.x*view.pixelsPerUnit,y:-q.y*view.pixelsPerUnit,z:p.z};});
      const blur=scene.component(scene.cameraNode.id,"GaussianBlur"),padding=blur?.enabled?4*Math.max(blur.sigmaWorld.x,blur.sigmaWorld.y)*view.pixelsPerUnit:0;
      const x=view.width/2+padding,y=view.height/2+padding;
      for(const distance of [(p:Vec3)=>p.x+x,(p:Vec3)=>x-p.x,(p:Vec3)=>p.y+y,(p:Vec3)=>y-p.y])points=clip(points,distance);
      return {visible:points.length>=3,css:`polygon(${points.map(p=>`${p.x}px ${p.y}px`).join(",")})`};
    }
    return {visible:points.length>=3,css:changed?`polygon(${points.map(p=>`${(p.x-origin.x)*units}px ${-(p.y-origin.y)*units}px`).join(",")})`:"none"};
  }
  clear():void{this.revision++;this.planes=[];this.opaque.clear();}
}
/** Interior particles usually touch no silhouette edge. A summed-area query
 * proves full coverage before the more expensive polygon/alpha-run clipping. */
function coveredBySprite(points:Vec3[],matrix:Matrix,eye:Vec3,z:number,mask:OpaqueSprite):boolean {
  if(points.length<3)return false;
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(const p of points){
    const q=M.point(matrix,{x:p.x,y:p.y,z}),d=eye.z-q.z;if(Math.abs(d)<1e-12)return false;
    const x=((eye.z*q.x-q.z*eye.x)/d-mask.origin.x)*mask.pixelsPerUnit,y=(mask.origin.y-(eye.z*q.y-q.z*eye.y)/d)*mask.pixelsPerUnit;
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  const x0=Math.floor(left),x1=Math.ceil(right),y0=Math.floor(top),y1=Math.ceil(bottom);
  if(x0<0||y0<0||x1>mask.width||y1>mask.height)return false;
  const s=mask.width+1,a=mask.integral;
  return a[y1*s+x1]-a[y0*s+x1]-a[y1*s+x0]+a[y0*s+x0]===(x1-x0)*(y1-y0);
}
function clip(points:Vec3[],distance:(p:Vec3)=>number):Vec3[] {
  const out:Vec3[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=distance(a),db=distance(b);
    if(da>=0)out.push(a);
    if((da>=0)!==(db>=0)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});}
  }
  return out;
}
