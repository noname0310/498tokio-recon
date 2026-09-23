import type { DOMRenderer } from "./dom.js";
import type { Scene } from "./scene.js";
import type { Entity, View, Matrix, Vec2, ParticleState, RGB } from "./types.js";
interface ParticleEntry {element:HTMLDivElement;surface:HTMLDivElement;blurFrame?:HTMLDivElement;image:HTMLImageElement;mask?:HTMLDivElement;glow:boolean;source:string;pending:Promise<void>}
interface DOMParticleGlow {filter:SVGFilterElement;matrix:SVGFEColorMatrixElement;blur:SVGFEGaussianBlurElement;gain:SVGFEFuncAElement}
interface DOMParticle {entries:ParticleEntry[];matrix:SVGFEColorMatrixElement;tint:string;tintFilter:SVGFilterElement;glow?:DOMParticleGlow;motion?:{filter:SVGFilterElement;spread:SVGFilterElement;blur:SVGFEGaussianBlurElement;dilate:SVGFEMorphologyElement;gain:SVGFEFuncAElement}}

/* Particle pools contain real DOM objects. Atlas frames are clipped images. */
import { Math3D as M } from "./math.js";
const NS="http://www.w3.org/2000/svg";
let serial=0;
const svg=<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>,parent:Element):SVGElementTagNameMap[K]=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent.append(e);return e;};
const div=(name:string,parent:Element)=>{const e=document.createElement("div");e.className=name;parent.append(e);return e;};
function projection(scene:Scene,view:View,relative:Matrix,transform:string,cell:Vec2,pad:Vec2){
  const camera=scene.requireComponent(scene.cameraNode.id,"Camera");
  let points=[[-.5-pad.x,-.5-pad.y],[.5+pad.x,-.5-pad.y],[.5+pad.x,.5+pad.y],[-.5-pad.x,.5+pad.y]].map(([x,y])=>({x,y,z:M.point(relative,{x,y,z:0}).z}));
  const inside=points.every(p=>p.z>=camera.near&&p.z<=camera.far);
  if(!inside)for(const [limit,sign] of [[camera.near,1],[camera.far,-1]]){
    const next=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],ai=(a.z-limit)*sign>=0,bi=(b.z-limit)*sign>=0;if(ai)next.push(a);if(ai!==bi){const t=(limit-a.z)/(b.z-a.z);next.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:limit});}}points=next;
  }
  const projected=points.map(p=>scene.projectCameraPoint(M.point(relative,{x:p.x,y:p.y,z:0})));
  const onscreen=projected.length>=3&&!projected.every(p=>p.x<-view.worldWidth/2)&&!projected.every(p=>p.x>view.worldWidth/2)&&!projected.every(p=>p.y<-view.worldHeight/2)&&!projected.every(p=>p.y>view.worldHeight/2);
  return {transform,visible:onscreen,clip:inside?"none":`polygon(${points.map(p=>`${(p.x+.5)*cell.x}px ${(.5-p.y)*cell.y}px`).join(",")})`};
}
export class DOMParticles {
  readonly renderer:DOMRenderer;readonly id:string;readonly pool:DOMParticle[];count:number;readonly filters:SVGFilterElement[];readonly hasGlow:boolean;readonly hasMotionBlur:boolean;readonly uid:string;
  private revision=0;private disposed=false;
  private colorSource="";private solidColor:RGB|null=null;
  private readonly sortGroup:number;
  private readonly activeParticles=new Map<string,DOMParticle>();private readonly spareParticles:DOMParticle[]=[];
  constructor(renderer:DOMRenderer,node:Entity){
    this.renderer=renderer;this.id=node.id;this.pool=[];this.count=0;this.filters=[];this.hasGlow=node.components.some(c=>c.type==="Glow");this.hasMotionBlur=node.components.some(c=>c.type==="ParticleMotionBlur");this.sortGroup=++serial;this.uid=`particles-${this.sortGroup}`;
  }
  filter(id:string){const f=svg("filter",{id,x:"-200%",y:"-200%",width:"500%",height:"500%","color-interpolation-filters":"sRGB"},this.renderer.defs);this.filters.push(f);return f;}
  create(){
    const index=this.pool.length,tint=this.filter(`${this.uid}-${index}`),matrix=svg("feColorMatrix",{},tint),entries=[];
    let glow:DOMParticleGlow|undefined;
    if(this.hasGlow&&this.hasMotionBlur){
      const filter=this.filter(`${this.uid}-${index}-glow`);filter.setAttribute("primitiveUnits","objectBoundingBox");
      const matrix=svg("feColorMatrix",{},filter);svg("feComposite",{in2:"SourceAlpha",operator:"in"},filter);
      const blur=svg("feGaussianBlur",{},filter),gain=svg("feFuncA",{type:"linear"},svg("feComponentTransfer",{},filter));
      glow={filter,matrix,blur,gain};
    }
    let motion:DOMParticle["motion"];
    if(this.hasMotionBlur){
      const filter=this.filter(`${this.uid}-${index}-motion`),spread=this.filter(`${this.uid}-${index}-spread`),dilate=svg("feMorphology",{operator:"dilate",radius:0},spread),blur=svg("feGaussianBlur",{},filter);
      const gain=svg("feFuncA",{type:"linear",slope:1},svg("feComponentTransfer",{},filter));motion={filter,spread,blur,dilate,gain};
    }
    for(const glow of [...(this.hasGlow?[true]:[]),false]){
      const element=this.renderer.createSurface(this.id,glow?"Glow":"ParticleEmitter");element.classList.add("particle");
      const blurFrame=motion?div("particle-blur",element):undefined,surface=div("sprite-surface",blurFrame||element),clip=div("sprite-clip",surface),image=new Image();image.alt="";clip.append(image);
      const mask=!this.hasMotionBlur?div(glow?"particle-glow-mask":"particle-color-mask",surface):undefined;
      entries.push({element,surface,blurFrame,image,mask,glow,source:"",pending:Promise.resolve()});
    }
    const particle={entries,matrix,tint:`url(#${tint.id})`,tintFilter:tint,glow,motion};this.pool.push(particle);return particle;
  }
  private assign(states:ParticleState[]):DOMParticle[]{
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
    const c=scene.requireComponent(this.id,"ParticleEmitter"),asset=scene.asset(c.asset),cell=asset.atlas?.cellSize||asset.size,source=scene.source(c.asset),glow=scene.component(this.id,"Glow"),states=scene.particleStates(this.id,scene.timelineTime,view),loading=[];
    if(!states.length||!this.renderer.resources.isImageReady(c.asset)){if(this.count)for(const p of this.pool)for(const entry of p.entries)sync.hidden(entry.element,true);this.count=0;return;}
    const [frames,glowFrames]=await Promise.all([this.renderer.resources.spriteFrames(scene,c.asset),glow?.enabled&&!this.hasMotionBlur?this.renderer.particleGlow.frames(scene,c.asset,glow):undefined]);
    if(!this.hasMotionBlur&&this.colorSource!==source){
      const pixels=await this.renderer.resources.image(scene,c.asset),data=pixels.data;
      if(this.disposed||revision!==this.revision)return;
      // Single-color artwork can be tinted by a CSS background through its
      // original alpha. Multicolor artwork keeps the general SVG color matrix.
      let color:RGB|null=null;
      for(let i=0;i<data.length;i+=4)if(data[i+3]){
        if(!color)color={r:data[i]/255,g:data[i+1]/255,b:data[i+2]/255};
        else if(data[i]/255!==color.r||data[i+1]/255!==color.g||data[i+2]/255!==color.b){color=null;break;}
      }
      this.colorSource=source;this.solidColor=color;
    }
    if(this.disposed||revision!==this.revision)return;
    this.count=states.length;
    const sortBySize=c.sortMode==="sizeAscending",sortDepth=sortBySize?this.renderer.viewDepth(scene,this.id,{x:0,y:0,z:0}):0;
    const slots=this.assign(states);
    const motion=scene.component(this.id,"ParticleMotionBlur"),dilation=motion?.enabled?motion.dilationPixels:0,softness=motion?.enabled?motion.softnessPixels:0,alphaGain=motion?.enabled?motion.alphaGain:1;
    for(let i=0;i<states.length;i++){
      const p=slots[i],s=states[i];
      // Mask-backed particles have fixed native layout; projection only changes
      // their transform. Live SVG filters keep display-resolution bounds so
      // Chromium's filter raster cache does not shift fractional sprite edges.
      const t=s.color,tinted=t.r!==1||t.g!==1||t.b!==1;
      const scale=this.solidColor&&!this.hasMotionBlur?8:Math.max(1e-6,view.pixelsPerUnit*Math.hypot(s.matrix[4],s.matrix[5],s.matrix[6])/cell.y),display={x:cell.x*scale,y:cell.y*scale};
      if(t.a===0||s.projectedArea===0){p.entries.forEach(entry=>sync.hidden(entry.element,true));continue;}
      const dx=s.blurUV.x*display.x,dy=s.blurUV.y*display.y,sigmaPixels=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),degrees=angle*180/Math.PI;
      const spread=dilation*scale,across=softness*scale,along=Math.hypot(sigmaPixels,across),filterActive=along>0||alphaGain!==1;
      const pad={x:(dilation+4*softness)/cell.x+4*Math.abs(s.blurUV.x),y:(dilation+4*softness)/cell.y+4*Math.abs(s.blurUV.y)};
      // Body and halo share one projected matrix; only their clipping bounds
      // differ. Keep the top-left pivot in the matrix, not fractional layout.
      const relative=M.multiply(scene.viewMatrix,s.matrix),css=scene.cssProjection(s.matrix,view,{x:display.x,y:display.y,z:1});
      for(let row=0;row<4;row++)css[12+row]-=(css[row]*display.x+css[4+row]*display.y)/2;
      const transform=`matrix3d(${css.join(",")})`,bodyProjection=projection(scene,view,relative,transform,display,pad),glowSigma=glow?.enabled?glow.sigmaWorld*asset.pixelsPerUnit:0;
      const glowProjection=glowSigma>0?projection(scene,view,relative,transform,display,{x:pad.x+4*glowSigma/cell.x,y:pad.y+4*glowSigma/cell.y}):bodyProjection;
      // Offscreen filter surfaces can still consume raster work before the
      // viewport clips them. Cull the full expanded effect, not just the sprite.
      if(!bodyProjection.visible&&!glowProjection.visible){p.entries.forEach(entry=>sync.hidden(entry.element,true));continue;}
      // Tint the glow inside its extraction matrix. A second SVG filter after
      // the blur allocated a 500%-wide surface and rerasterized the same halo.
      if(p.glow&&glow){
        const color=glow.color,slope=1/glow.softness,sigma=glow.sigmaWorld*asset.pixelsPerUnit,padding=dilation+4*sigma;
        sync.attribute(p.glow.matrix,"values",`0 0 0 0 ${color.r*t.r} 0 0 0 0 ${color.g*t.g} 0 0 0 0 ${color.b*t.b} ${.2126*slope} ${.7152*slope} ${.0722*slope} 0 ${-glow.threshold*slope}`);
        sync.attribute(p.glow.blur,"stdDeviation",`${sigma/cell.x} ${sigma/cell.y}`);sync.attribute(p.glow.gain,"slope",glow.intensity*color.a);
        sync.attrs(p.glow.filter,{x:`${-padding/cell.x*100}%`,y:`${-padding/cell.y*100}%`,width:`${100+2*padding/cell.x*100}%`,height:`${100+2*padding/cell.y*100}%`});
      }
      const tintPadding=dilation+1/scale;
      sync.attrs(p.tintFilter,{x:`${-tintPadding/cell.x*100}%`,y:`${-tintPadding/cell.y*100}%`,width:`${100+2*tintPadding/cell.x*100}%`,height:`${100+2*tintPadding/cell.y*100}%`});
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
        const {element,surface,blurFrame,image,mask,glow:isGlow}=entry;
        const cachedGlow=Boolean(isGlow&&mask&&glowFrames&&glow),maskedBody=Boolean(!isGlow&&mask&&this.solidColor&&tinted),masked=cachedGlow||maskedBody;
        sync.hidden(image,masked);
        if(mask){
          sync.hidden(mask,!masked);
          if(masked){
            const padding=cachedGlow?glowFrames!.padding:{x:0,y:0},color=cachedGlow?glow!.color:this.solidColor!,src=cachedGlow?glowFrames!.images[s.frame].src:frames[s.frame].src;
            sync.style(mask,{position:"absolute",left:`${-padding.x*scale}px`,top:`${-padding.y*scale}px`,width:`${(cell.x+2*padding.x)*scale}px`,height:`${(cell.y+2*padding.y)*scale}px`,backgroundColor:`rgb(${color.r*t.r*255} ${color.g*t.g*255} ${color.b*t.b*255})`,maskImage:`url("${src}")`,maskSize:"100% 100%",maskRepeat:"no-repeat",imageRendering:cachedGlow||asset.filter!=="point"?"auto":"crisp-edges"});
          }
        }
        const frameSource=frames[s.frame].src;
        if(!masked&&entry.source!==frameSource){entry.source=frameSource;sync.attribute(image,"src",frameSource);entry.pending=image.decode().then(()=>{if(entry.source===frameSource&&(image.naturalWidth!==cell.x||image.naturalHeight!==cell.y))throw new Error(`Asset dimensions do not match the scene: ${c.asset}`);});}
        loading.push(entry.pending);
        const pr=isGlow?glowProjection:bodyProjection;
        this.renderer.setDepth(element,sortBySize?sortDepth:s.depth,sortBySize?s.projectedArea:0,this.sortGroup*40002+i*2+(isGlow?0:1));
        sync.hidden(element,!pr.visible||(isGlow&&!glow?.enabled));sync.attribute(element,"data-particle",s.id);sync.attribute(element,"data-frame",s.frame);
        sync.style(element,{transform:pr.transform,clipPath:pr.clip,opacity:t.a,mixBlendMode:(isGlow?glow?.blend==="additive":c.blend==="additive")?"plus-lighter":"normal"});
        if(blurFrame&&p.motion)sync.style(blurFrame,{position:"absolute",left:"0px",top:"0px",width:`${display.x}px`,height:`${display.y}px`,transformOrigin:"50% 50%",transform:`rotate(${degrees}deg)`,filter:filterActive?`url(#${p.motion.filter.id})`:"none"});
        sync.style(surface,{left:"0px",top:"0px",width:`${display.x}px`,height:`${display.y}px`,transformOrigin:"50% 50%",transform:blurFrame?`rotate(${-degrees}deg)`:"none",filter:masked?"none":[dilation>0&&p.motion?`url(#${p.motion.spread.id})`:"",isGlow&&p.glow?`url(#${p.glow.filter.id})`:tinted?p.tint:""].filter(Boolean).join(" ")||"none"});
        sync.style(image,{width:`${display.x}px`,height:`${display.y}px`,left:"0px",top:"0px",imageRendering:asset.filter==="point"?"crisp-edges":"auto"});
      }
      // Size sorting changes surface ranks, while each living particle keeps
      // its image and filters. New births cannot invalidate every tint/atlas slot.
    }
    await Promise.all(loading);
  }
  dispose(){this.disposed=true;this.revision++;this.pool.forEach(p=>p.entries.forEach(e=>this.renderer.removeSurface(e.element)));this.filters.forEach(f=>f.remove());this.pool.length=0;this.activeParticles.clear();this.spareParticles.length=0;}
}
