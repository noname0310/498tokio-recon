import type { DOMRenderer } from "./dom.js";
import type { Scene } from "./scene.js";
import type { Entity, View, Matrix, Vec2, ParticleState } from "./types.js";
interface ParticleEntry {element:HTMLDivElement;surface:HTMLDivElement;blurFrame?:HTMLDivElement;image:HTMLImageElement;glow:boolean;source:string;pending:Promise<void>}
interface DOMParticle {entries:ParticleEntry[];matrix:SVGFEColorMatrixElement;tint:string;motion?:{filter:SVGFilterElement;spread:SVGFilterElement;blur:SVGFEGaussianBlurElement;dilate:SVGFEMorphologyElement;gain:SVGFEFuncAElement}}

/* Particle pools contain real DOM objects. Atlas frames are clipped images. */
import { Math3D as M } from "./math.js";
const NS="http://www.w3.org/2000/svg";
let serial=0;
const svg=<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>,parent:Element):SVGElementTagNameMap[K]=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent.append(e);return e;};
const div=(name:string,parent:Element)=>{const e=document.createElement("div");e.className=name;parent.append(e);return e;};
function projection(scene:Scene,view:View,matrix:Matrix,cell:Vec2,pad:Vec2){
  const camera=scene.requireComponent(scene.cameraNode.id,"Camera"),relative=M.multiply(M.inverse(scene.world.get(scene.cameraNode.id)!),matrix),css=scene.cssProjection(matrix,view,{x:cell.x,y:cell.y,z:1});
  let points=[[-.5-pad.x,-.5-pad.y],[.5+pad.x,-.5-pad.y],[.5+pad.x,.5+pad.y],[-.5-pad.x,.5+pad.y]].map(([x,y])=>({x,y,z:M.point(relative,{x,y,z:0}).z}));
  const inside=points.every(p=>p.z>=camera.near&&p.z<=camera.far);
  for(const [limit,sign] of [[camera.near,1],[camera.far,-1]]){
    const next=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],ai=(a.z-limit)*sign>=0,bi=(b.z-limit)*sign>=0;if(ai)next.push(a);if(ai!==bi){const t=(limit-a.z)/(b.z-a.z);next.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:limit});}}points=next;
  }
  const projected=points.map(p=>scene.projectCameraPoint(M.point(relative,{x:p.x,y:p.y,z:0})));
  const onscreen=projected.length>=3&&!projected.every(p=>p.x<-view.worldWidth/2)&&!projected.every(p=>p.x>view.worldWidth/2)&&!projected.every(p=>p.y<-view.worldHeight/2)&&!projected.every(p=>p.y>view.worldHeight/2);
  return {transform:`matrix3d(${css.join(",")})`,visible:onscreen,clip:inside?"none":`polygon(${points.map(p=>`${p.x*cell.x}px ${-p.y*cell.y}px`).join(",")})`};
}
export class DOMParticles {
  readonly renderer:DOMRenderer;readonly id:string;readonly pool:DOMParticle[];count:number;readonly filters:SVGFilterElement[];readonly hasGlow:boolean;readonly hasMotionBlur:boolean;readonly uid:string;
  glowFilter!:SVGFilterElement;glowMatrix!:SVGFEColorMatrixElement;blur!:SVGFEGaussianBlurElement;gain!:SVGFEFuncAElement;
  private revision=0;private disposed=false;
  private readonly sortGroup:number;
  private readonly activeParticles=new Map<string,DOMParticle>();private readonly spareParticles:DOMParticle[]=[];private keyed=false;
  constructor(renderer:DOMRenderer,node:Entity){
    this.renderer=renderer;this.id=node.id;this.pool=[];this.count=0;this.filters=[];this.hasGlow=node.components.some(c=>c.type==="Glow");this.hasMotionBlur=node.components.some(c=>c.type==="ParticleMotionBlur");this.sortGroup=++serial;this.uid=`particles-${this.sortGroup}`;
    if(this.hasGlow){
      this.glowFilter=this.filter(this.uid+"-glow");this.glowFilter.setAttribute("primitiveUnits","objectBoundingBox");
      this.glowMatrix=svg("feColorMatrix",{},this.glowFilter);svg("feComposite",{in2:"SourceAlpha",operator:"in"},this.glowFilter);
      this.blur=svg("feGaussianBlur",{},this.glowFilter);this.gain=svg("feFuncA",{type:"linear"},svg("feComponentTransfer",{},this.glowFilter));
    }
  }
  filter(id:string){const f=svg("filter",{id,x:"-200%",y:"-200%",width:"500%",height:"500%","color-interpolation-filters":"sRGB"},this.renderer.defs);this.filters.push(f);return f;}
  create(){
    const index=this.pool.length,tint=this.filter(`${this.uid}-${index}`),matrix=svg("feColorMatrix",{},tint),entries=[];
    let motion:DOMParticle["motion"];
    if(this.hasMotionBlur){
      const filter=this.filter(`${this.uid}-${index}-motion`),spread=this.filter(`${this.uid}-${index}-spread`),dilate=svg("feMorphology",{operator:"dilate",radius:0},spread),blur=svg("feGaussianBlur",{},filter);
      const gain=svg("feFuncA",{type:"linear",slope:1},svg("feComponentTransfer",{},filter));motion={filter,spread,blur,dilate,gain};
    }
    for(const glow of [...(this.hasGlow?[true]:[]),false]){
      const element=this.renderer.createSurface(this.id,glow?"Glow":"ParticleEmitter");element.classList.add("particle");
      const blurFrame=motion?div("particle-blur",element):undefined,surface=div("sprite-surface",blurFrame||element),clip=div("sprite-clip",surface),image=new Image();image.alt="";clip.append(image);
      entries.push({element,surface,blurFrame,image,glow,source:"",pending:Promise.resolve()});
    }
    const particle={entries,matrix,tint:`url(#${tint.id})`,motion};this.pool.push(particle);return particle;
  }
  private assign(states:ParticleState[],keyed:boolean):DOMParticle[]{
    if(!keyed){if(this.keyed){this.activeParticles.clear();this.spareParticles.length=0;}this.keyed=false;return this.pool;}
    if(!this.keyed){this.spareParticles.push(...this.pool);for(const p of this.pool)p.entries.forEach(entry=>this.renderer.sync.hidden(entry.element,true));this.keyed=true;}
    const alive=new Set(states.map(state=>state.id));
    for(const [id,particle] of this.activeParticles)if(!alive.has(id)){
      this.activeParticles.delete(id);this.spareParticles.push(particle);particle.entries.forEach(entry=>this.renderer.sync.hidden(entry.element,true));
    }
    return states.map(state=>{
      let particle=this.activeParticles.get(state.id);
      if(!particle){particle=this.spareParticles.pop()||this.create();this.activeParticles.set(state.id,particle);}
      return particle;
    });
  }
  async update(scene:Scene,view:View){
    const sync=this.renderer.sync,revision=++this.revision;
    const c=scene.requireComponent(this.id,"ParticleEmitter"),asset=scene.asset(c.asset),cell=asset.atlas?.cellSize||asset.size,source=scene.source(c.asset),glow=scene.component(this.id,"Glow"),states=scene.particleStates(this.id),loading=[];
    const frames=asset.atlas?await this.renderer.resources.spriteFrames(scene,c.asset):undefined;
    if(this.disposed||revision!==this.revision)return;
    this.count=states.length;
    const sortBySize=c.sortMode==="sizeAscending",sortDepth=sortBySize?this.renderer.viewDepth(scene,this.id,{x:0,y:0,z:0}):0;
    const slots=this.assign(states,sortBySize);
    const motion=scene.component(this.id,"ParticleMotionBlur"),dilation=motion?.enabled?motion.dilationPixels:0,softness=motion?.enabled?motion.softnessPixels:0,alphaGain=motion?.enabled?motion.alphaGain:1;
    if(glow){
      const color=glow.color,slope=1/glow.softness,sigma=glow.sigmaWorld*asset.pixelsPerUnit;
      sync.attribute(this.glowMatrix,"values",`0 0 0 0 ${color.r} 0 0 0 0 ${color.g} 0 0 0 0 ${color.b} ${.2126*slope} ${.7152*slope} ${.0722*slope} 0 ${-glow.threshold*slope}`);
      sync.attribute(this.blur,"stdDeviation",`${sigma/cell.x} ${sigma/cell.y}`);sync.attribute(this.gain,"slope",String(glow.intensity*color.a));
      for(const [key,value] of Object.entries({x:-4*sigma/cell.x*100,y:-4*sigma/cell.y*100,width:100+8*sigma/cell.x*100,height:100+8*sigma/cell.y*100}))sync.attribute(this.glowFilter,key,String(value+"%"));
    }
    for(let i=0;i<Math.max(slots.length,states.length);i++){
      const p=slots[i]||this.create(),s=states[i];
      if(!s){p.entries.forEach(e=>sync.hidden(e.element,true));continue;}
      // Prepare the cell at display resolution before parent rotation/projection;
      // its source bounds never depend on the original atlas column.
      const t=s.color,tinted=t.r!==1||t.g!==1||t.b!==1,scale=Math.max(1e-6,view.pixelsPerUnit*Math.hypot(s.matrix[4],s.matrix[5],s.matrix[6])/cell.y),display={x:cell.x*scale,y:cell.y*scale};
      const dx=s.blurUV.x*display.x,dy=s.blurUV.y*display.y,sigmaPixels=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),degrees=angle*180/Math.PI;
      const spread=dilation*scale,across=softness*scale,along=Math.hypot(sigmaPixels,across),filterActive=along>0||alphaGain!==1;
      const pad={x:(dilation+4*softness)/cell.x+4*Math.abs(s.blurUV.x),y:(dilation+4*softness)/cell.y+4*Math.abs(s.blurUV.y)};
      const bodyProjection=projection(scene,view,s.matrix,display,pad),glowSigma=glow?.enabled?glow.sigmaWorld*asset.pixelsPerUnit:0;
      const glowProjection=glowSigma>0?projection(scene,view,s.matrix,display,{x:pad.x+4*glowSigma/cell.x,y:pad.y+4*glowSigma/cell.y}):bodyProjection;
      // Offscreen filter surfaces can still consume raster work before the
      // viewport clips them. Cull the full expanded effect, not just the sprite.
      if(!bodyProjection.visible&&!glowProjection.visible){p.entries.forEach(entry=>sync.hidden(entry.element,true));continue;}
      if(p.motion){
        sync.attribute(p.motion.dilate,"radius",String(spread));sync.attribute(p.motion.blur,"stdDeviation",`${along} ${across}`);sync.attribute(p.motion.gain,"slope",String(alphaGain));
        // The filter is horizontal in its own frame; counter-rotate the art so
        // only the blur turns. The particle's geometry and UVs never stretch.
        const bx=(Math.abs(Math.cos(angle))*(display.x+2*spread)+Math.abs(Math.sin(angle))*(display.y+2*spread))/2+4*along;
        const by=(Math.abs(Math.sin(angle))*(display.x+2*spread)+Math.abs(Math.cos(angle))*(display.y+2*spread))/2+4*across;
        for(const [key,value] of Object.entries({x:(.5-bx/display.x)*100,y:(.5-by/display.y)*100,width:2*bx/display.x*100,height:2*by/display.y*100}))sync.attribute(p.motion.filter,key,`${value}%`);
      }
      sync.attribute(p.matrix,"values",`${t.r} 0 0 0 0 0 ${t.g} 0 0 0 0 0 ${t.b} 0 0 0 0 0 1 0`);
      for(const entry of p.entries){
        const {element,surface,blurFrame,image,glow:isGlow}=entry;
        const frameSource=frames?frames[s.frame].src:source;
        if(entry.source!==frameSource){entry.source=frameSource;sync.attribute(image,"src",frameSource);entry.pending=image.decode().then(()=>{if(entry.source===frameSource&&(image.naturalWidth!==cell.x||image.naturalHeight!==cell.y))throw new Error(`Asset dimensions do not match the scene: ${c.asset}`);});}
        loading.push(entry.pending);
        const pr=isGlow?glowProjection:bodyProjection;
        this.renderer.setDepth(element,sortBySize?sortDepth:s.depth,sortBySize?s.projectedArea:0,sortBySize?this.sortGroup*40002+i*2+(isGlow?0:1):0);
        sync.hidden(element,!pr.visible||(isGlow&&!glow?.enabled));sync.attribute(element,"data-particle",s.id);sync.attribute(element,"data-frame",s.frame);
        sync.style(element,{transform:pr.transform,clipPath:pr.clip,opacity:t.a,mixBlendMode:(isGlow?glow?.blend==="additive":c.blend==="additive")?"plus-lighter":"normal"});
        if(blurFrame&&p.motion)sync.style(blurFrame,{position:"absolute",left:`${-display.x/2}px`,top:`${-display.y/2}px`,width:`${display.x}px`,height:`${display.y}px`,transformOrigin:"50% 50%",transform:`rotate(${degrees}deg)`,filter:filterActive?`url(#${p.motion.filter.id})`:"none"});
        sync.style(surface,{left:blurFrame?"0px":`${-display.x/2}px`,top:blurFrame?"0px":`${-display.y/2}px`,width:`${display.x}px`,height:`${display.y}px`,transformOrigin:"50% 50%",transform:blurFrame?`rotate(${-degrees}deg)`:"none",filter:[dilation>0&&p.motion?`url(#${p.motion.spread.id})`:"",isGlow?`url(#${this.uid}-glow)`:"",tinted?p.tint:""].filter(Boolean).join(" ")||"none"});
        sync.style(image,{width:`${display.x}px`,height:`${display.y}px`,left:"0px",top:"0px",imageRendering:asset.filter==="point"?"crisp-edges":"auto"});
      }
      // Size sorting changes surface ranks, while each living particle keeps
      // its image and filters. New births cannot invalidate every tint/atlas slot.
    }
    await Promise.all(loading);
  }
  dispose(){this.disposed=true;this.revision++;this.pool.forEach(p=>p.entries.forEach(e=>this.renderer.removeSurface(e.element)));this.filters.forEach(f=>f.remove());this.pool.length=0;this.activeParticles.clear();this.spareParticles.length=0;}
}
