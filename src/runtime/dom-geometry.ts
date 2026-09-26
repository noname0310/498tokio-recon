import type {DOMRenderer} from "./dom.js";
import type {Scene} from "./scene.js";
import type {Bounds,Color,Entity,View} from "./types.js";
import {lineGeometry,planeBounds,planeSize,transitionGeometryKey} from "./geometry.js";
import {DOMTransitionPath} from "./dom-transition-path.js";
import {DOMPlaneNoise} from "./dom-plane-noise.js";
const NS="http://www.w3.org/2000/svg";
let serial=0;
const color=(c:Color)=>`rgb(${c.r*255} ${c.g*255} ${c.b*255})`;
function layout(sync:DOMRenderer["sync"],element:HTMLElement,b:Bounds,u:number){sync.style(element,{position:"absolute",left:`${b.left*u}px`,top:`${-b.top*u}px`,width:`${(b.right-b.left)*u}px`,height:`${(b.top-b.bottom)*u}px`});}
export class DOMPlane {
  readonly id:string;readonly element:HTMLDivElement;readonly fill=document.createElement("div");
  private grid?:SVGSVGElement;private gridPath?:SVGPathElement;
  private shape?:HTMLDivElement;private ringClip?:SVGClipPathElement;private ringPath?:SVGPathElement;
  private readonly pathGeometry=new DOMTransitionPath();private gridKey="";
  private softEdgeKey="";
  private readonly noise?:DOMPlaneNoise;
  constructor(readonly renderer:DOMRenderer,node:Entity){this.id=node.id;this.element=renderer.createSurface(node.id,"PlaneRenderer");this.element.append(this.fill);if(node.components.some(c=>c.type==="ProceduralNoise"))this.noise=new DOMPlaneNoise(renderer);}
  async update(scene:Scene,view:View):Promise<void>{
    const sync=this.renderer.sync;
    const c=scene.requireComponent(this.id,"PlaneRenderer");
    if(!c.enabled||!scene.active.get(this.id)||c.color.a===0){sync.hidden(this.element,true);return;}
    const bounds=planeBounds(scene,this.id,view,c);
    if(!bounds){sync.hidden(this.element,true);return;}
    const size=planeSize(scene,view,c);
    this.renderer.setDepth(this.element,this.renderer.planeDepth(scene,this.id,bounds));
    sync.style(this.element,{transform:scene.cssMatrix(this.id,view),mixBlendMode:c.blend==="additive"?"plus-lighter":"normal"});const clip=this.renderer.depth.clipPlane(scene,this.id,view,bounds);sync.hidden(this.element,!clip.visible);sync.style(this.element,{clipPath:clip.css});
    const soft=c.shape==="ellipse"&&c.edgeSoftness>0,ring=c.shape==="ellipse"&&c.innerRadiusRatio>0&&!soft;
    if(ring){
      if(!this.shape){
        this.shape=document.createElement("div");this.shape.style.position="absolute";
        this.ringClip=document.createElementNS(NS,"clipPath");this.ringClip.id=`plane-ring-${++serial}`;this.ringClip.setAttribute("clipPathUnits","userSpaceOnUse");
        this.ringPath=document.createElementNS(NS,"path");this.ringPath.setAttribute("clip-rule","evenodd");this.ringClip.append(this.ringPath);this.renderer.defs.append(this.ringClip);
        this.shape.append(this.fill);if(this.grid)this.shape.append(this.grid);this.element.append(this.shape);
      }
      const x=size.x*view.pixelsPerUnit/2,y=size.y*view.pixelsPerUnit/2,k=c.innerRadiusRatio;
      const ellipse=(x:number,y:number)=>`M ${x} 0 A ${x} ${y} 0 1 0 ${-x} 0 A ${x} ${y} 0 1 0 ${x} 0 Z`;
      sync.attribute(this.ringPath!,"d",`${ellipse(x,y)} ${ellipse(x*k,y*k)}`);
    }
    if(this.shape)sync.style(this.shape,{clipPath:ring?`url(#${this.ringClip!.id})`:"none"});
    layout(sync,this.fill,bounds,view.pixelsPerUnit);sync.style(this.fill,{backgroundColor:soft?"transparent":color(c.color),borderRadius:c.shape==="ellipse"&&!ring&&!soft?"50%":"0"});sync.style(this.fill,{opacity:String(c.color.a)});
    if(soft){
      const key=JSON.stringify([size,c.color.r,c.color.g,c.color.b,c.innerRadiusRatio,c.edgeSoftness,bounds,view.pixelsPerUnit]);
      if(key!==this.softEdgeKey){
        this.softEdgeKey=key;const extent=1+c.edgeSoftness,rgb=`${c.color.r*255} ${c.color.g*255} ${c.color.b*255}`;
        const smooth=(lo:number,hi:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
        const stops=Array.from({length:129},(_,i)=>{const r=extent*i/128,e=c.edgeSoftness;let a=1-smooth(1-e,1+e,r);if(c.innerRadiusRatio>0)a*=c.innerRadiusRatio>=1?0:smooth(c.innerRadiusRatio-e,c.innerRadiusRatio+e,r);return `rgb(${rgb} / ${a}) ${i/128*100}%`;});
        const u=view.pixelsPerUnit;sync.style(this.fill,{backgroundImage:`radial-gradient(ellipse ${size.x*extent*u/2}px ${size.y*extent*u/2}px at ${-bounds.left*u}px ${bounds.top*u}px,${stops.join(',')})`});
      }
    }else{this.softEdgeKey="";sync.style(this.fill,{backgroundImage:"none"});}
    const pendingNoise=this.noise?.update(this.fill,bounds,view.pixelsPerUnit,scene.component(this.id,"ProceduralNoise"));
    const transition=scene.component(this.id,"Transition");
    if(!transition?.enabled||transition.progress>=1){sync.hidden(this.fill,false);if(this.grid)sync.hidden(this.grid,true);await pendingNoise;return;}
    sync.hidden(this.fill,true);
    if(transition.progress<=0){if(this.grid)sync.hidden(this.grid,true);await pendingNoise;return;}
    if(!this.grid){
      this.grid=document.createElementNS(NS,"svg");this.grid.classList.add("transition-grid");this.grid.setAttribute("aria-hidden","true");this.grid.setAttribute("preserveAspectRatio","none");
      this.gridPath=document.createElementNS(NS,"path");this.gridPath.setAttribute("fill-rule","nonzero");this.grid.append(this.gridPath);(this.shape??this.element).append(this.grid);
    }
    const grid=this.grid,u=view.pixelsPerUnit;sync.hidden(grid,false);
    sync.style(grid,{filter:this.fill.style.filter});
    sync.style(grid,{position:"absolute",left:`${bounds.left*u}px`,top:`${-bounds.top*u}px`,width:`${(bounds.right-bounds.left)*u}px`,height:`${(bounds.top-bounds.bottom)*u}px`});
    sync.attribute(grid,"viewBox",`${bounds.left} ${-bounds.top} ${bounds.right-bounds.left} ${bounds.top-bounds.bottom}`);
    sync.attribute(grid,"fill",color(c.color));sync.attribute(grid,"opacity",String(c.color.a));
    // Drawing overscan must not change the authored transition timing.
    const frameBounds=planeBounds(scene,this.id,view,c,0)!;
    const key=JSON.stringify([bounds,frameBounds,transitionGeometryKey(transition)]);
    if(key!==this.gridKey){this.gridKey=key;sync.attribute(this.gridPath!,"d",this.pathGeometry.transition(bounds,frameBounds,transition,(x,y)=>({x,y:-y})));}
    await pendingNoise;
    // The first texture finishes asynchronously. Copy the completed filter as
    // well, so a paused transition needs no extra animation tick to show noise.
    sync.style(grid,{filter:this.fill.style.filter});
  }
  dispose():void{this.noise?.dispose();this.ringClip?.remove();this.renderer.removeSurface(this.element);}
}
export class DOMLine {
  readonly id:string;readonly layers:{element:HTMLDivElement;svg:SVGSVGElement;line:SVGLineElement}[]=[];
  readonly filter=document.createElementNS(NS,"filter");readonly blur=document.createElementNS(NS,"feGaussianBlur");
  readonly gain=document.createElementNS(NS,"feFuncA");
  constructor(readonly renderer:DOMRenderer,node:Entity){
    this.id=node.id;this.filter.id=`line-glow-${++serial}`;this.filter.setAttribute("filterUnits","userSpaceOnUse");this.filter.setAttribute("color-interpolation-filters","sRGB");this.filter.append(this.blur);
    const transfer=document.createElementNS(NS,"feComponentTransfer");this.gain.setAttribute("type","linear");transfer.append(this.gain);this.filter.append(transfer);renderer.defs.append(this.filter);
    for(const type of ["Glow","LineRenderer"] as const){const element=renderer.createSurface(node.id,type),svg=document.createElementNS(NS,"svg"),line=document.createElementNS(NS,"line");svg.style.overflow="visible";svg.setAttribute("aria-hidden","true");svg.append(line);element.append(svg);this.layers.push({element,svg,line});}
  }
  async update(scene:Scene,view:View):Promise<void>{
    const sync=this.renderer.sync;
    const c=scene.requireComponent(this.id,"LineRenderer");
    if(!scene.active.get(this.id)||!c.enabled||c.color.a===0){this.layers.forEach(l=>sync.hidden(l.element,true));return;}
    const shape=lineGeometry(scene,this.id,view,c),glow=scene.component(this.id,"Glow");
    // Keep SVG/filter backing surfaces near display resolution. A distant
    // plane can span hundreds of world units; using viewport units directly
    // would create 30,000px SVGs that exceed browser texture limits.
    const center={x:(c.start.x+c.end.x)/2,y:(c.start.y+c.end.y)/2,z:0};
    const centerDepth=this.renderer.viewDepth(scene,this.id,center);
    const extent=shape?Math.max(shape.bounds.right-shape.bounds.left,shape.bounds.top-shape.bounds.bottom):1;
    const u=Math.min(view.pixelsPerUnit/Math.max(1,scene.frustumScale(Math.max(.001,centerDepth))),4096/Math.max(1,extent));
    for(let i=0;i<2;i++){
      const {element,svg,line}=this.layers[i],isGlow=i===0,offset=isGlow?.0001:0;
      sync.style(element,{mixBlendMode:isGlow&&glow?.blend==="additive"?"plus-lighter":"normal"});
      if(!shape||(isGlow&&!glow?.enabled)){sync.hidden(element,true);continue;}
      this.renderer.setDepth(element,this.renderer.viewDepth(scene,this.id,{...center,z:offset}));
      const b=shape.bounds;const clip=this.renderer.depth.clipPlane(scene,this.id,view,b,offset,{x:0,y:0},u);sync.hidden(element,!clip.visible);sync.style(element,{clipPath:clip.css});sync.style(element,{transform:scene.cssMatrix(this.id,view,{x:0,y:0,z:offset},u)});
      sync.style(svg,{position:"absolute",left:`${b.left*u}px`,top:`${-b.top*u}px`,width:`${(b.right-b.left)*u}px`,height:`${(b.top-b.bottom)*u}px`});sync.attribute(svg,"viewBox",`${b.left*u} ${-b.top*u} ${(b.right-b.left)*u} ${(b.top-b.bottom)*u}`);
      for(const [key,value] of Object.entries({x1:shape.start.x*u,y1:-shape.start.y*u,x2:shape.end.x*u,y2:-shape.end.y*u,"stroke-width":shape.width*u,"stroke-opacity":c.color.a*(isGlow?(glow?.color.a??1):1)}))sync.attribute(line,key,String(value));
      sync.attribute(line,"stroke",color(isGlow&&glow?glow.color:c.color));sync.attribute(line,"stroke-linecap","butt");sync.attribute(line,"filter",isGlow?`url(#${this.filter.id})`:"none");
      if(isGlow&&glow){sync.attribute(this.blur,"stdDeviation",String(glow.sigmaWorld*u));sync.attribute(this.gain,"slope",String(glow.intensity*Math.max(0,Math.min(1,(.2126*c.color.r+.7152*c.color.g+.0722*c.color.b-glow.threshold)/glow.softness))));for(const [key,value] of Object.entries({x:b.left*u,y:-b.top*u,width:(b.right-b.left)*u,height:(b.top-b.bottom)*u}))sync.attribute(this.filter,key,String(value));}
    }
  }
  dispose():void{this.layers.forEach(l=>this.renderer.removeSurface(l.element));this.filter.remove();}
}
