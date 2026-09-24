import type {Scene} from "./scene.js";
import type {Resources} from "./resources.js";
import type {Bounds,Matrix,PixelImage,Vec2,Vec3,View} from "./types.js";
import {Math3D as M} from "./math.js";

interface Occluder {id:string;inverse:Matrix;side:number;eye:Vec3;bounds:Bounds|null}
/** Opaque tiled planes are depth writers in Babylon. The flat DOM graph clips
 * transparent surfaces against their camera rays before composition. */
export class DOMPlanarDepth {
  readonly opaque=new Set<string>();
  private planes:Occluder[]=[];
  private revision=0;
  private readonly opacity=new WeakMap<PixelImage,boolean>();
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
    const planes=await Promise.all(candidates.map(async id=>{
      const c=scene.requireComponent(id,"TiledSpriteRenderer"),world=scene.world.get(id)!,pixels=await resources.image(scene,c.asset);
      let opaque=this.opacity.get(pixels);
      if(opaque===undefined){opaque=true;for(let i=3;i<pixels.data.length;i+=4)if(pixels.data[i]!==255){opaque=false;break;}this.opacity.set(pixels,opaque);}
      if(!opaque)return null;
      const inverse=M.inverse(world),relative=M.multiply(inverse,cameraWorld),side=Math.sign(relative[14]);
      // A plane crossing the near clip cannot be represented by one visible
      // half-space. Keep regular sorting for that degenerate configuration.
      const radius=Math.hypot(relative[2],relative[6],relative[10])*camera.near;
      if(!side||Math.abs(relative[14])<=radius)return null;
      return {id,inverse,side,eye:{x:relative[12],y:relative[13],z:relative[14]},bounds:c.clipBounds};
    }));
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
      const next:Vec3[][]=[];
      for(const polygon of polygons){
        if(polygon.every(p=>front(p)>=-1e-9)){next.push(polygon);continue;}
        if(!plane.bounds){changed=true;const visible=clip(polygon,front);if(visible.length>=3)next.push(visible);continue;}
        const eye=plane.eye,bounds=plane.bounds;
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
function clip(points:Vec3[],distance:(p:Vec3)=>number):Vec3[] {
  const out:Vec3[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=distance(a),db=distance(b);
    if(da>=0)out.push(a);
    if((da>=0)!==(db>=0)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});}
  }
  return out;
}
