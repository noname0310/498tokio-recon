import {DOMNumber} from "./dom-number.js";
import type { Scene } from "./scene.js";
import type { Resources } from "./resources.js";
import type { Entity, View, ComponentType, RenderObject, PixelImage, Vec3, RGB, Bounds } from "./types.js";
interface SpriteElement {element:HTMLDivElement;image:HTMLImageElement;filter:string|null}

/* DOM backend. Scene ownership and all numerical parameters come from data. */
import { DOMParticles } from "./dom-particles.js";
import {DOMParticleGlow} from "./dom-particle-glow.js";
import type {LoadingProgress} from "./loading-status.js";
import {DOMPlane,DOMLine} from "./dom-geometry.js";
import {DOMCylinder} from "./dom-cylinder.js";
import {DOMSync} from "./dom-sync.js";
import {DOMPlanarDepth} from "./dom-depth.js";
import {DOMTransitions} from "./dom-transitions.js";
import {DOMViewportFrame} from "./dom-viewport-frame.js";
import {transitionGroups} from "./transitions.js";
import {Math3D as M} from "./math.js";
import {clippedBounds} from "./geometry.js";
import {motionBounds,motionSamples} from "./sprite-motion-blur.js";
const NS="http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>={},parent?:Element):SVGElementTagNameMap[K]{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent?.append(e);return e;}
function div(className:string,parent?:Element){const e=document.createElement("div");e.className=className;parent?.append(e);return e;}
const enabled=<T extends {enabled:boolean}>(c:T|undefined):c is T=>Boolean(c?.enabled);
type NoiseChannels=readonly [SVGFEFuncRElement,SVGFEFuncGElement,SVGFEFuncBElement];
function noiseChannels(parent:SVGFilterElement,input:string,result?:string):NoiseChannels {
  const transfer=svg("feComponentTransfer",{in:input,...result?{result}:{}},parent);
  return [svg("feFuncR",{type:"identity"},transfer),svg("feFuncG",{type:"identity"},transfer),svg("feFuncB",{type:"identity"},transfer)];
}
function updateNoiseChannels(sync:DOMSync,channels:NoiseChannels,gain:RGB){
  // noiseURL encodes exp(n)/2. Gamma maps it to exp(n*gain)/2,
  // so color edits keep the original grayscale texture and worker cache.
  for(const [index,value] of [gain.r,gain.g,gain.b].entries()){
    sync.attrs(channels[index],{type:value===1?"identity":"gamma",amplitude:Math.pow(2,value-1),exponent:value,offset:0});
  }
}
let serial=0;

class Sprite {
  private readonly motionImages:HTMLImageElement[]=[];
  private readonly shapeFilter:SVGFilterElement;private readonly shapeDilation:SVGFEMorphologyElement;private readonly shapeSoftness:SVGFEGaussianBlurElement;
  private readonly motionGainFilter:SVGFilterElement;private readonly motionGain:SVGFEFuncAElement;
  readonly renderer:DOMRenderer;readonly id:string;readonly elements:Map<"SpriteRenderer"|"DropShadow"|"Glow",SpriteElement>;
  sourceKey:string|null;readonly filters:SVGFilterElement[];readonly shadowBlur:SVGFEGaussianBlurElement;readonly shadowOffset:SVGFEOffsetElement;readonly shadowColor:SVGFEFloodElement;
  readonly glowMatrix:SVGFEColorMatrixElement;readonly glowBlur:SVGFEGaussianBlurElement;readonly glowGain:SVGFEFuncAElement;readonly tintMatrix:SVGFEColorMatrixElement;readonly tintFilter:string;
  noiseDefinition!:SVGFilterElement;noiseFilter!:string;noiseRevision=0;noiseImage!:SVGFEImageElement;noiseTiles!:SVGFETileElement;
  noiseChannels!:NoiseChannels;
  noiseKey?:string;noiseURL?:string;noisePending?:Promise<void>;disposed=false;
  private updateRevision=0;
  constructor(renderer:DOMRenderer,node:Entity){
    this.renderer=renderer;this.id=node.id;this.elements=new Map();this.sourceKey=null;
    const uid=`sprite-${++serial}`,defs=renderer.defs;
    const filter=(suffix:string)=>svg("filter",{id:uid+suffix,x:"-200%",y:"-200%",width:"500%",height:"500%","color-interpolation-filters":"sRGB"},defs);
    this.filters=[];
    const shadow=filter("-shadow");this.filters.push(shadow);
    this.shadowBlur=svg("feGaussianBlur",{in:"SourceAlpha",result:"blur"},shadow);
    this.shadowOffset=svg("feOffset",{in:"blur",result:"offset"},shadow);
    this.shadowColor=svg("feFlood",{result:"color"},shadow);svg("feComposite",{in:"color",in2:"offset",operator:"in"},shadow);
    const glow=filter("-glow");this.filters.push(glow);
    this.glowMatrix=svg("feColorMatrix",{},glow);svg("feComposite",{in2:"SourceAlpha",operator:"in"},glow);
    this.glowBlur=svg("feGaussianBlur",{},glow);this.glowGain=svg("feFuncA",{type:"linear"},svg("feComponentTransfer",{},glow));
    const tint=filter("-tint");this.filters.push(tint);this.tintMatrix=svg("feColorMatrix",{},tint);
    this.shapeFilter=filter("-shape");this.filters.push(this.shapeFilter);this.shapeDilation=svg("feMorphology",{operator:"dilate"},this.shapeFilter);this.shapeSoftness=svg("feGaussianBlur",{},this.shapeFilter);
    this.motionGainFilter=filter("-motion-gain");this.filters.push(this.motionGainFilter);this.motionGain=svg("feFuncA",{type:"linear"},svg("feComponentTransfer",{},this.motionGainFilter));
    if(node.components.some(c=>c.type==="ProceduralNoise")){
      const noise=svg("filter",{id:uid+"-noise",filterUnits:"userSpaceOnUse","color-interpolation-filters":"sRGB"},defs);
      this.filters.push(noise);this.noiseDefinition=noise;this.noiseFilter=`url(#${uid}-noise)`;this.noiseRevision=0;
      this.noiseImage=svg("feImage",{result:"grainTile",preserveAspectRatio:"none","image-rendering":"optimizeSpeed"},noise);
      this.noiseTiles=svg("feTile",{in:"grainTile",result:"grain"},noise);
      this.noiseChannels=noiseChannels(noise,"grain","coloredGrain");
      // Multiply straight RGB, then restore source alpha once. The secondary
      // texture cannot fill transparent cells or change translucent edges.
      svg("feColorMatrix",{in:"SourceGraphic",values:"1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1",result:"opaqueArt"},noise);
      svg("feComposite",{in:"opaqueArt",in2:"coloredGrain",operator:"arithmetic",k1:2,k2:0,k3:0,k4:0,result:"texturedArt"},noise);
      svg("feComposite",{in:"texturedArt",in2:"SourceAlpha",operator:"in"},noise);
    }
    for(const [type,suffix] of [["DropShadow","-shadow"],["Glow","-glow"],["SpriteRenderer",""]] as const){
      if(!node.components.some(c=>c.type===type))continue;
      const element=renderer.createSurface(node.id,type),image=new Image();image.alt="";element.append(image);
      this.elements.set(type,{element,image,filter:suffix?`url(#${uid+suffix})`:null});
    }
    this.tintFilter=`url(#${uid}-tint)`;
  }
  async update(scene:Scene,view:View){
    const sync=this.renderer.sync;
    const revision=++this.updateRevision,sprite=scene.requireComponent(this.id,"SpriteRenderer"),asset=scene.asset(sprite.asset);
    const state=scene.spriteState(this.id);
    // Hidden scene hierarchies must not decode/swap every frame of their loops.
    // Incrementing updateRevision above also cancels older pending visible work.
    if(!scene.active.get(this.id)||!state.visible||!this.renderer.resources.isImageReady(sprite.asset)){for(const {element} of this.elements.values())sync.hidden(element,true);return;}
    const source=(await this.renderer.resources.spriteFrames(scene,sprite.asset))[state.frame].src;
    if(this.disposed||revision!==this.updateRevision)return;
    // spriteFrames already decoded this source. Do not wait for another
    // decode on each newly spawned surface (or each atlas frame).
    if(this.sourceKey!==source){this.sourceKey=source;for(const {image} of this.elements.values()){image.decoding="sync";image.src=source;}}
    // The prepared source has fixed cell bounds, independent of atlas position.
    const motion=scene.component(this.id,"SpriteMotionBlur"),filtered=motion?.enabled&&(motion.dilationPixels>0||motion.softnessPixels>0),rasterScale=filtered||this.renderer.depth.enabled?8:1;
    const units=asset.pixelsPerUnit*rasterScale,width=state.size.x*rasterScale,height=state.size.y*rasterScale;
    // Compose the pivot into the projected transform. Chromium rounds an
    // image's fractional layout offset before scaling its parent (e.g. -6.5
    // at 6x became a 3px shift). Keep integer native bounds at a zero origin;
    // camera fitting, entity scale and the pivot all belong to the matrix.
    const origin={x:-asset.pivot.x*width/units,y:(1-asset.pivot.y)*height/units};
    const visible=scene.active.get(this.id)&&state.visible,shadow=scene.component(this.id,"DropShadow"),glow=scene.component(this.id,"Glow");
    const opacity=sprite.color.a;
    const moving=motion?.enabled&&(motion.radialAmount>0||motion.translationWorld.x!==0||motion.translationWorld.y!==0);
    if(!visible){for(const {element} of this.elements.values())sync.hidden(element,true);return;}
    const sortAnchor=scene.spriteSortAnchor(this.id),groupDepth=sortAnchor?M.point(scene.viewMatrix,sortAnchor).z:undefined;
    for(const [type,{element,image,filter}] of this.elements){
      const surface=image;
      sync.attribute(element,"data-frame",state.frame);
      const c=scene.component(this.id,type);
      sync.style(element,{mixBlendMode:c?.type==="Glow"&&c.blend==="additive"?"plus-lighter":"normal"});
      const offsetZ=type==="DropShadow"?.0002:type==="Glow"?.0001:0;
      sync.style(element,{transform:scene.cssMatrix(this.id,view,{...origin,z:offsetZ},units)});
      const pad=c&&"sigmaWorld" in c?4*c.sigmaWorld:0,dx=c?.type==="DropShadow"?c.offsetWorld.x:0,dy=c?.type==="DropShadow"?c.offsetWorld.y:0;
      this.renderer.setDepth(element,groupDepth??this.renderer.viewDepth(scene,this.id,{x:(.5-asset.pivot.x)*width/units+dx,y:(.5-asset.pivot.y)*height/units+dy,z:offsetZ}),sprite.sortingOrder*4+(sortAnchor?(type==="DropShadow"?-2:type==="Glow"?-1:0):0));
      const bounds={left:-asset.pivot.x*width/units-pad+Math.min(0,dx),right:(1-asset.pivot.x)*width/units+pad+Math.max(0,dx),bottom:-asset.pivot.y*height/units-pad+Math.min(0,dy),top:(1-asset.pivot.y)*height/units+pad+Math.max(0,dy)};
      const clipping=this.renderer.depth.clipPlane(scene,this.id,view,motion?.enabled&&type==="SpriteRenderer"?motionBounds(bounds,motion,asset.pixelsPerUnit):bounds,offsetZ,origin,units);
      sync.hidden(element,!enabled(c)||!clipping.visible);sync.style(element,{clipPath:clipping.visible?clipping.css:"none"});
      sync.style(surface,{left:"0px",top:"0px",width:`${width}px`,height:`${height}px`});
      sync.style(image,{imageRendering:asset.filter==="point"?"crisp-edges":"auto"});
      if(filter)sync.style(surface,{filter:type==="Glow"&&sprite.hueDegrees?`${filter} hue-rotate(${sprite.hueDegrees}deg)`:filter});
    }
    if(shadow){
      sync.attribute(this.shadowBlur,"stdDeviation",String(shadow.sigmaWorld*units));
      sync.attribute(this.shadowOffset,"dx",String(shadow.offsetWorld.x*units));sync.attribute(this.shadowOffset,"dy",String(-shadow.offsetWorld.y*units));
      sync.attribute(this.shadowColor,"flood-color",`rgb(${shadow.color.r*255} ${shadow.color.g*255} ${shadow.color.b*255})`);
      sync.attribute(this.shadowColor,"flood-opacity",String(shadow.color.a*shadow.opacity*opacity));
    }
    if(glow){
      const color=glow.color,slope=1/glow.softness;
      sync.attribute(this.glowMatrix,"values",`0 0 0 0 ${color.r} 0 0 0 0 ${color.g} 0 0 0 0 ${color.b} ${.2126*slope} ${.7152*slope} ${.0722*slope} 0 ${-glow.threshold*slope}`);
      sync.attribute(this.glowBlur,"stdDeviation",String(glow.sigmaWorld*units));sync.attribute(this.glowGain,"slope",String(glow.intensity*color.a*opacity));
    }
    const c=sprite.color,w=sprite.whiteMix,k=1-w,tinted=c.r!==1||c.g!==1||c.b!==1||w!==0;
    sync.attribute(this.tintMatrix,"values",`${c.r*k} 0 0 0 ${c.r*w} 0 ${c.g*k} 0 0 ${c.g*w} 0 0 ${c.b*k} 0 ${c.b*w} 0 0 0 1 0`);
    const body=this.elements.get("SpriteRenderer")!.image;
    const gradient=scene.component(this.id,"OpacityGradient");
    if(gradient?.enabled){
      const dx=(gradient.end.x-gradient.start.x)*units,dy=-(gradient.end.y-gradient.start.y)*units,length=Math.hypot(dx,dy),nx=dx/length,ny=dy/length;
      const start=((gradient.start.x-origin.x)*units-width/2)*nx+((origin.y-gradient.start.y)*units-height/2)*ny+(Math.abs(nx)*width+Math.abs(ny)*height)/2;
      sync.style(body,{maskImage:`linear-gradient(${Math.atan2(nx,-ny)*180/Math.PI}deg,transparent ${start}px,black ${start+length}px)`});
    }else sync.style(body,{maskImage:"none"});
    const noise=scene.component(this.id,"ProceduralNoise"),hasNoise=enabled(noise)&&noise.bands.some(b=>b.variance>0);
    sync.attribute(this.shapeDilation,"radius",filtered?motion.dilationPixels*rasterScale:0);sync.attribute(this.shapeSoftness,"stdDeviation",filtered?motion.softnessPixels*rasterScale:0);
    const bodyFilters=[filtered?`url(#${this.shapeFilter.id})`:"",tinted?this.tintFilter:"",sprite.hueDegrees?`hue-rotate(${sprite.hueDegrees}deg)`:"",sprite.saturation!==1?`saturate(${sprite.saturation})`:"",sprite.brightness!==1?`brightness(${sprite.brightness})`:"",sprite.contrast!==1?`contrast(${sprite.contrast})`:""];
    const applyNoise=()=>sync.style(body,{filter:[...bodyFilters,hasNoise&&this.noiseURL?this.noiseFilter:""].filter(Boolean).join(" ")||"none"});
    applyNoise();
    if(noise){
      updateNoiseChannels(sync,this.noiseChannels,noise.channelGain);
      const tileWidth=noise.worldSize.x*units,tileHeight=noise.worldSize.y*units;
      const phase=(value:number,period:number)=>((value%period)+period)%period-period;
      const x=phase(noise.origin.x*units+asset.pivot.x*width,tileWidth),y=phase(-noise.origin.y*units+(1-asset.pivot.y)*height,tileHeight);
      sync.attribute(this.noiseImage,"x",String(x));sync.attribute(this.noiseImage,"y",String(y));
      sync.attribute(this.noiseImage,"width",String(tileWidth));sync.attribute(this.noiseImage,"height",String(tileHeight));
      // feTile must receive the entire first tile, including its negative
      // phase. Clipping that input at the sprite edge would repeat holes.
      for(const [key,value] of Object.entries({x,y,width:Math.max(width,x+tileWidth)-x,height:Math.max(height,y+tileHeight)-y}))sync.attribute(this.noiseDefinition,key,String(value));
      for(const [key,value] of Object.entries({x:0,y:0,width,height}))sync.attribute(this.noiseTiles,key,String(value));
      const key=this.renderer.resources.noiseKey(noise);
      if(key!==this.noiseKey){
        this.noiseKey=key;const revision=++this.noiseRevision;
        this.noisePending=this.renderer.resources.noiseURL(noise).then(result=>{
          if(this.disposed||revision!==this.noiseRevision)return;
          this.noiseURL=result.url;sync.attribute(this.noiseImage,"href",String(result.url));
        });
      }
      await this.noisePending;
      if(this.disposed||revision!==this.updateRevision)return;
      applyNoise();
    }
    // Keep filter regions large enough when a component's radius is changed.
    for(const [index,effect] of [[0,shadow],[1,glow]] as const)if(effect){
      const pad=4*effect.sigmaWorld*units+(effect.type==="DropShadow"?Math.max(Math.abs(effect.offsetWorld.x),Math.abs(effect.offsetWorld.y))*units:0);
      const filter=this.filters[index];sync.attribute(filter,"x",`${-pad/width*100}%`);sync.attribute(filter,"y",`${-pad/height*100}%`);sync.attribute(filter,"width",`${100+2*pad/width*100}%`);sync.attribute(filter,"height",`${100+2*pad/height*100}%`);
    }
    if(this.disposed||revision!==this.updateRevision)return;
    const bodyElement=this.elements.get("SpriteRenderer")!.element;
    sync.style(bodyElement,{width:`${width}px`,height:`${height}px`,overflow:motion?.enabled&&motion.clipToSprite?"hidden":"visible"});
    const gain=motion?.enabled?motion.alphaGain:1;sync.attribute(this.motionGain,"slope",gain);sync.style(bodyElement,{opacity:String(opacity),filter:gain!==1?`url(#${this.motionGainFilter.id})`:"none"});
    const gainBounds=motion?.enabled?motionBounds({left:0,right:width/units,bottom:-height/units,top:0},{...motion,center:{x:motion.center.x-origin.x,y:motion.center.y-origin.y}},asset.pixelsPerUnit):null;
    if(gainBounds)sync.attrs(this.motionGainFilter,{filterUnits:"userSpaceOnUse",x:gainBounds.left*units,y:-gainBounds.top*units,width:(gainBounds.right-gainBounds.left)*units,height:(gainBounds.top-gainBounds.bottom)*units});
    if(moving){
      const samples=motionSamples(motion.samples);
      while(this.motionImages.length<motion.samples-1){const copy=new Image();copy.alt="";bodyElement.append(copy);this.motionImages.push(copy);}
      sync.style(bodyElement,{isolation:"isolate"});
      const images=[...this.motionImages.slice(0,(motion.samples-1)/2),body,...this.motionImages.slice((motion.samples-1)/2)];
      for(let i=0;i<images.length;i++){
        const image=images[i];sync.hidden(image,i>=motion.samples);if(i>=motion.samples)continue;
        if(image!==body){if(image.src!==body.src)image.src=body.src;sync.style(image,{position:"absolute",left:"0px",top:"0px",width:`${width}px`,height:`${height}px`,imageRendering:asset.filter==="point"?"crisp-edges":"auto",filter:body.style.filter,maskImage:body.style.maskImage});}
        const t=samples[i*2],weight=samples[i*2+1];sync.style(image,{mixBlendMode:"plus-lighter",opacity:String(weight),transformOrigin:`${(motion.center.x-origin.x)*units}px ${(origin.y-motion.center.y)*units}px`,transform:`translate(${t*motion.translationWorld.x*units}px, ${-t*motion.translationWorld.y*units}px) scale(${1+t*motion.radialAmount})`});
      }
    }else{
      this.motionImages.forEach(image=>sync.hidden(image,true));sync.style(bodyElement,{isolation:"auto"});sync.style(body,{mixBlendMode:"normal",transform:"none",opacity:"1"});
    }
  }
  dispose(){this.disposed=true;this.noiseRevision++;this.filters.forEach(f=>f.remove());this.elements.forEach(({element})=>this.renderer.removeSurface(element));}
}

interface TileSlot {top:SVGRectElement[];bottom:SVGRectElement[];group:SVGGElement}
class TiledSprite {
  private readonly projection:HTMLDivElement;
  private readonly crop:SVGClipPathElement;private readonly cropRect:SVGRectElement;
  private readonly repeatPattern:SVGPatternElement;private readonly repeatRect:SVGRectElement;
  private readonly glowBlur?:SVGFEGaussianBlurElement;private readonly glowGain?:SVGFEFuncAElement;
  private readonly slots:TileSlot[]=[];
  private readonly rows:SVGUseElement[]=[];
  private readonly paths=new Map<string,SVGPathElement>();
  private readonly palette=new Map<string,{x:number;y:number;width:number;height:number}[]>();
  private readonly repeatGeometry=new Map<number,Map<string,string>>();
  private artworkKey="";
  readonly renderer:DOMRenderer;readonly id:string;readonly element:HTMLDivElement;readonly surface:HTMLDivElement;readonly svg:SVGSVGElement;readonly artID:string;readonly art:SVGGElement;readonly tiles:SVGGElement;readonly grain:HTMLDivElement;
  readonly filter:SVGFilterElement;readonly blur:SVGFEGaussianBlurElement;readonly tintFilter:SVGFilterElement;readonly tintMatrix:SVGFEColorMatrixElement;
  readonly directionalFilter:SVGFilterElement;readonly directionalBlur:SVGFEGaussianBlurElement;readonly blurAxes:SVGGElement;readonly contentAxes:SVGGElement;
  readonly noiseColorFilter:SVGFilterElement;readonly noiseChannels:NoiseChannels;
  noiseKey:string|null;noiseURL:string|null;noiseRevision:number;noisePending?:Promise<void>;updateRevision=0;sourceKey?:string;layoutKey?:string|null;pixelPending?:Promise<PixelImage>;pixels?:PixelImage;
  constructor(renderer:DOMRenderer,node:Entity){
    this.renderer=renderer;this.id=node.id;this.element=renderer.createSurface(node.id,"TiledSpriteRenderer");
    this.projection=div("tile-projection",this.element);this.projection.style.cssText="position:absolute;transform-origin:0 0";
    this.surface=div("background-surface",this.projection);this.svg=svg("svg",{class:"pattern",preserveAspectRatio:"none","aria-hidden":"true"},this.surface);
    this.artID=`tile-${++serial}`;this.blurAxes=svg("g",{},this.svg);this.contentAxes=svg("g",{},this.blurAxes);this.art=svg("g",{id:this.artID,"data-role":"tile-art"},this.contentAxes);this.tiles=svg("g",{},this.contentAxes);this.grain=div("noise",this.surface);
    this.repeatPattern=svg("pattern",{id:this.artID+"-repeat",patternUnits:"userSpaceOnUse"},svg("defs",{},this.svg));this.repeatRect=svg("rect",{fill:`url(#${this.artID}-repeat)`,display:"none"},this.contentAxes);
    this.crop=svg("clipPath",{id:this.artID+"-crop",clipPathUnits:"userSpaceOnUse"},renderer.defs);this.cropRect=svg("rect",{},this.crop);
    this.directionalFilter=svg("filter",{id:this.artID+"-directional",x:"-50%",y:"-50%",width:"200%",height:"200%","color-interpolation-filters":"sRGB"},renderer.defs);this.directionalBlur=svg("feGaussianBlur",{},this.directionalFilter);
    this.filter=svg("filter",{id:this.artID+"-blur",x:"-10%",y:"-10%",width:"120%",height:"120%","color-interpolation-filters":"sRGB"},renderer.defs);
    this.blur=svg("feGaussianBlur",{},this.filter);this.noiseKey=null;this.noiseURL=null;this.noiseRevision=0;
    if(node.components.some(c=>c.type==="Glow")){
      this.blur.setAttribute("result","body");this.glowBlur=svg("feGaussianBlur",{in:"body"},this.filter);const transfer=svg("feComponentTransfer",{},this.filter);this.glowGain=svg("feFuncA",{type:"linear"},transfer);const merge=svg("feMerge",{},this.filter);svg("feMergeNode",{},merge);svg("feMergeNode",{in:"body"},merge);
      for(const [key,value]of Object.entries({x:"-100%",y:"-100%",width:"300%",height:"300%"}))this.filter.setAttribute(key,value);
    }
    this.tintFilter=svg("filter",{id:this.artID+"-tint",x:"0",y:"0",width:"100%",height:"100%","color-interpolation-filters":"sRGB"},renderer.defs);
    this.tintMatrix=svg("feColorMatrix",{},this.tintFilter);
    this.noiseColorFilter=svg("filter",{id:this.artID+"-noise-color",x:"0",y:"0",width:"100%",height:"100%","color-interpolation-filters":"sRGB"},renderer.defs);
    this.noiseChannels=noiseChannels(this.noiseColorFilter,"SourceGraphic");
  }
  async update(scene:Scene,view:View){
    const sync=this.renderer.sync;
    // An inactive update must also cancel a pending visible update. Otherwise
    // an awaited image can resume after a seek and reveal the old scene.
    const updateRevision=++this.updateRevision;
    const c=scene.requireComponent(this.id,"TiledSpriteRenderer"),asset=scene.asset(c.asset),blur=scene.component(this.id,"GaussianBlur"),noise=scene.component(this.id,"ProceduralNoise");
    const visible=!!scene.active.get(this.id)&&c.enabled&&this.renderer.resources.isImageReady(c.asset);if(!visible){sync.hidden(this.element,true);sync.style(this.svg,{willChange:"auto"});return;}
    const world=scene.world.get(this.id)!;
    const worldScale=Math.max(Math.hypot(world[0],world[1],world[2]),Math.hypot(world[4],world[5],world[6]));
    const effectUnits=view.pixelsPerUnit*(c.clipBounds&&(enabled(blur)||scene.component(this.id,"Glow")?.enabled)?8:1);
    // CSS perspective composites a rasterized SVG. A large world scale can
    // otherwise magnify a one-pixel backing texel into a broad bilinear smear.
    // Keep native texels resolved, while bounding the SVG backing resolution.
    const units=scene.requireComponent(scene.cameraNode.id,"Camera").projection==="perspective"
      ?Math.max(effectUnits,Math.min(asset.pixelsPerUnit*8,view.pixelsPerUnit*worldScale)):effectUnits;
    const screenClip=c.wrap.y==="repeat"&&scene.requireComponent(scene.cameraNode.id,"Camera").projection==="perspective";
    const transform=scene.cssMatrix(this.id,view,{x:0,y:0,z:0},units);
    sync.style(this.element,{transform:screenClip?"none":transform});sync.style(this.projection,{transform:screenClip?transform:"none"});
    const source=scene.source(c.asset);
    if(source!==this.sourceKey){
      this.sourceKey=source;this.layoutKey=null;this.pixelPending=this.renderer.resources.image(scene,c.asset);
    }
    const pixels=await this.pixelPending;if(updateRevision!==this.updateRevision)return;
    if(pixels!==this.pixels){
      this.pixels=pixels;
      this.artworkKey="";this.palette.clear();this.repeatGeometry.clear();
      // Coalesce identical horizontal runs, then extend matching runs through
      // adjacent rows. Exact rectangles preserve every pixel/alpha value while
      // avoiding thousands of tiny paths for a mostly solid tile background.
      let previous=new Map<string,{x:number;y:number;width:number;height:number}>();
      for(let y=0;y<asset.size.y;y++){
        const next=new Map<string,{x:number;y:number;width:number;height:number}>();
        for(let x=0;x<asset.size.x;){
          const fill=this.rgb(x,y),start=x++;
          while(x<asset.size.x&&this.rgb(x,y)===fill)x++;
          const width=x-start,key=`${start}/${width}/${fill}`;
          let rect=previous.get(key);
          if(rect)rect.height++;
          else {rect={x:start,y,width,height:1};let cells=this.palette.get(fill);if(!cells)this.palette.set(fill,cells=[]);cells.push(rect);}
          next.set(key,rect);
        }
        previous=next;
      }
    }
    if(!this.pixels||!visible)return;
    const directional=scene.component(this.id,"DirectionalBlur"),bounds=clippedBounds(scene.coverage(this.id,view,.1+(enabled(directional)?4*directional.sigmaWorld:0)),c.clipBounds);
    if(!bounds){sync.hidden(this.element,true);sync.style(this.svg,{willChange:"auto"});return;}
    sync.attribute(this.contentAxes,"clip-path",c.clipBounds&&c.wrap.y!=="repeat"?`url(#${this.artID}-crop)`:"none");
    this.renderer.setDepth(this.element,this.renderer.planeDepth(scene,this.id,bounds));
    const clipping=this.renderer.depth.clipPlane(scene,this.id,view,bounds,0,{x:0,y:0},units,screenClip);sync.hidden(this.element,!clipping.visible);sync.style(this.element,{clipPath:clipping.visible?clipping.css:"none"});
    let left=bounds.left*units,top=-bounds.top*units,right=bounds.right*units,bottom=-bounds.bottom*units;
    if(c.wrap.y==="repeat"&&scene.requireComponent(scene.cameraNode.id,"Camera").projection==="perspective"){
      // Quantize only the backing rectangle, never the camera or UV phase.
      // A retained guard band avoids resizing/rasterizing the SVG for every
      // subpixel camera movement and keeps native cell edges on a stable grid.
      const quantum=64*units/asset.pixelsPerUnit;
      left=Math.floor(left/quantum)*quantum;top=Math.floor(top/quantum)*quantum;
      right=Math.ceil(right/quantum)*quantum;bottom=Math.ceil(bottom/quantum)*quantum;
    }
    const matrix=new DOMMatrix(transform);
    if(Math.abs(matrix.m11-1)<1e-9&&Math.abs(matrix.m22-1)<1e-9&&Math.abs(matrix.m12)+Math.abs(matrix.m21)+Math.abs(matrix.m13)+Math.abs(matrix.m23)<1e-9){
      const x=view.width/2+matrix.m41,y=view.height/2+matrix.m42,dpr=view.dpr;
      left=Math.floor((left+x)*dpr)/dpr-x;top=Math.floor((top+y)*dpr)/dpr-y;right=Math.ceil((right+x)*dpr)/dpr-x;bottom=Math.ceil((bottom+y)*dpr)/dpr-y;
    }
    if(c.clipBounds){
      // Coverage already bounds the backing surface. Clip to the authored
      // plane, so moving the camera does not invalidate a cached SVG pattern
      // by rewriting a redundant, camera-dependent clip rectangle.
      const clip=c.clipBounds,x=clip.left===null?left:clip.left*units,y=clip.top===null?top:-clip.top*units;
      sync.attrs(this.cropRect,{x,y,width:(clip.right===null?right:clip.right*units)-x,height:(clip.bottom===null?bottom:-clip.bottom*units)-y});
    }
    const width=right-left,height=bottom-top,hasNoise=enabled(noise)&&noise.bands.some(b=>b.variance>0);
    const color=c.color,gray=color.r===color.g&&color.g===color.b,s=c.saturation,luma=[.213,.715,.072];
    // One sRGB matrix applies saturation, then RGB gain, with a single clamp.
    // This matches the shader even when oversaturation makes a channel negative.
    const colorMatrix=[color.r,color.g,color.b].flatMap((gain,row)=>[...luma.map((v,col)=>gain*((1-s)*v+(row===col?s:0))),0,0]);
    sync.attribute(this.tintMatrix,"values",String([...colorMatrix,0,0,0,1,0].join(" ")));
    const tint=gray&&s===1?(color.r===1?"":`brightness(${color.r})`):`url(#${this.artID}-tint)`;
    sync.style(this.surface,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`,opacity:color.a,filter:[hasNoise?"brightness(2)":"",tint].filter(Boolean).join(" ")||"none"});sync.attribute(this.svg,"viewBox",`${left} ${top} ${width} ${height}`);
    const cell=units/asset.pixelsPerUnit,tileWidth=asset.size.x*cell,tileHeight=asset.size.y*cell,y0=-c.origin.y*units,y1=y0+tileHeight,bleed=cell/2;
    // One spare tile covers every scroll phase. Geometry must not alternate
    // between two path lengths whenever the viewport crosses a tile boundary.
    const x0=c.origin.x*units,first=Math.floor((left-x0)/tileWidth),count=Math.ceil(width/tileWidth)+1;
    const repeatY=c.wrap.y==="repeat"||c.wrap.y==="repeatBottom";
    const patternRepeat=c.wrap.y==="repeat";
    const firstRow=repeatY?Math.max(c.wrap.y==="repeatBottom"?0:-Infinity,Math.floor((top-y0)/tileHeight)):0;
    const rowCount=repeatY?Math.max(0,Math.ceil((bottom-y0)/tileHeight)-firstRow):1;
    sync.style(this.art,{display:rowCount?"":"none"});
    if(patternRepeat){
      // A pattern retains one native tile. Expanding every visible row/column
      // into vector geometry can paint hundreds of thousands of cells near
      // a perspective horizon and churn Chromium's raster tile cache.
      if(this.art.parentNode!==this.repeatPattern)this.repeatPattern.append(this.art);
      sync.attribute(this.art,"transform","");
      sync.attrs(this.repeatPattern,{width:asset.size.x,height:asset.size.y,patternTransform:`translate(${x0} ${y0}) scale(${cell})`});
      // The repeated fill is already rectangular; trim its geometry instead
      // of allocating another large SVG raster mask for the authored crop.
      const crop=c.clipBounds,rx=Math.max(left,(crop?.left??-Infinity)*units),ry=Math.max(top,-(crop?.top??Infinity)*units);
      const rr=Math.min(right,(crop?.right??Infinity)*units),rb=Math.min(bottom,-(crop?.bottom??-Infinity)*units);
      sync.attrs(this.repeatRect,{x:rx,y:ry,width:rr-rx,height:rb-ry,"shape-rendering":"auto"});
    }else{
      if(this.art.parentNode!==this.contentAxes)this.contentAxes.prepend(this.art);
      sync.attribute(this.art,"transform",`translate(${x0+first*tileWidth} ${y0+firstRow*tileHeight}) scale(${cell})`);
    }
    sync.attribute(this.repeatRect,"display",patternRepeat?"inline":"none");
    // Repeat the retained horizontal strip with SVG references. Portrait views
    // allocate row slots once; scrolling never duplicates per-pixel geometry.
    if(!patternRepeat)while(this.rows.length<rowCount-1)this.rows.push(svg("use",{href:`#${this.artID}`},this.contentAxes));
    this.rows.forEach((row,i)=>{sync.style(row,{display:!patternRepeat&&repeatY&&i<rowCount-1?"":"none"});if(!patternRepeat&&repeatY&&i<rowCount-1)sync.attribute(row,"transform",`translate(0 ${(i+1)*tileHeight})`);});
    const geometryCount=patternRepeat?1:count,artworkKey=JSON.stringify([source,geometryCount]);
    if(artworkKey!==this.artworkKey){
      this.artworkKey=artworkKey;
      // Batch equal-color cells across the visible repeat range. The paths
      // remain DOM objects. Scrolling changes their group transform; geometry
      // only changes on viewport size/source changes. Cache recent sizes.
      let commands=this.repeatGeometry.get(geometryCount);
      if(!commands){
        commands=new Map();
        for(const [fill,cells] of this.palette){
          const parts:string[]=[];
          for(let tile=0;tile<geometryCount;tile++)for(const {x,y,width,height} of cells)parts.push(`M${tile*asset.size.x+x} ${y}h${width}v${height}h-${width}z`);
          commands.set(fill,parts.join(""));
        }
        if(this.repeatGeometry.size===2)this.repeatGeometry.delete(this.repeatGeometry.keys().next().value!);
        this.repeatGeometry.set(geometryCount,commands);
      }
      for(const [fill,d] of commands){let path=this.paths.get(fill);if(!path){path=svg("path",{fill},this.art);this.paths.set(fill,path);}sync.attribute(path,"d",d);}
      for(const [fill,path] of this.paths)if(!commands.has(fill)){path.remove();this.paths.delete(fill);}
    }
    const key=JSON.stringify([source,left,top,width,height,cell,c.origin,c.wrap]);
    if(key!==this.layoutKey){
      this.layoutKey=key;
      // Clamp strips use stable slots. Capacity only grows with the view.
      if(!repeatY&&this.slots.length<count)for(let i=this.slots.length;i<count+2;i++){
        const group=svg("g",{},this.tiles);
        this.slots.push({group,top:[],bottom:[]});
      }
      for(let i=0;i<this.slots.length;i++){
        const slot=this.slots[i];sync.style(slot.group,{display:!repeatY&&i<count?"":"none"});if(repeatY||i>=count)continue;
        const x=x0+(first+i)*tileWidth;
        const showTop=c.wrap.y==="clamp"&&top<y0+bleed,showBottom=c.wrap.y!=="transparent"&&bottom>y1-bleed;
        for(let col=0;col<Math.max(asset.size.x,slot.top.length,slot.bottom.length);col++){
          for(const side of ["top","bottom"] as const){
            const show=col<asset.size.x&&(side==="top"?showTop:showBottom);let strip=slot[side][col];
            if(show&&!strip)strip=slot[side][col]=svg("rect",{},slot.group);
            if(!strip)continue;sync.style(strip,{display:show?"":"none"});if(!show)continue;
            sync.attrs(strip,{x:x+col*cell,y:side==="top"?top:y1-bleed,width:cell,height:side==="top"?y0-top+bleed:bottom-y1+bleed,fill:this.rgb(col,side==="top"?0:asset.size.y-1)});
          }
        }
      }
    }
    const glow=scene.component(this.id,"Glow");
    if(this.glowBlur&&this.glowGain){sync.attribute(this.glowBlur,"stdDeviation",glow?.enabled?glow.sigmaWorld*units:0);sync.attribute(this.glowGain,"slope",glow?.enabled?glow.intensity:0);}
    sync.style(this.svg,{filter:enabled(blur)||enabled(glow)?`url(#${this.artID}-blur)`:"none"});
    if(blur)sync.attribute(this.blur,"stdDeviation",`${blur.sigmaWorld.x*units} ${blur.sigmaWorld.y*units}`);
    const liveBlur=enabled(directional)&&directional.sigmaWorld>0;
    // Chromium can present missing raster tiles when a filtered SVG changes
    // bounds under perspective. Retain its compositor layer while visible;
    // orthographic/inactive surfaces do not need this allocation hint.
    const composited=clipping.visible&&(patternRepeat||enabled(blur)||enabled(glow)||liveBlur)&&scene.requireComponent(scene.cameraNode.id,"Camera").projection==="perspective";
    sync.style(this.svg,{willChange:composited?"transform":"auto"});
    sync.attribute(this.blurAxes,"filter",liveBlur?`url(#${this.artID}-directional)`:"none");
    sync.attribute(this.blurAxes,"transform",liveBlur?`rotate(${-directional.angleDegrees})`:"");sync.attribute(this.contentAxes,"transform",liveBlur?`rotate(${directional.angleDegrees})`:"");
    if(liveBlur)sync.attribute(this.directionalBlur,"stdDeviation",`${directional.sigmaWorld*units} 0`);
    sync.hidden(this.grain,!hasNoise);
    if(noise){
      const gain=noise.channelGain;
      updateNoiseChannels(sync,this.noiseChannels,gain);
      sync.style(this.grain,{filter:gain.r===1&&gain.g===1&&gain.b===1?"none":`url(#${this.artID}-noise-color)`});
      sync.style(this.grain,{backgroundSize:`${noise.worldSize.x*units}px ${noise.worldSize.y*units}px`});sync.style(this.grain,{backgroundPosition:`${noise.origin.x*units-left}px ${-noise.origin.y*units-top}px`});
      const key=this.renderer.resources.noiseKey(noise);
      if(key!==this.noiseKey){
        this.noiseKey=key;const revision=++this.noiseRevision;
        this.noisePending=this.renderer.resources.noiseURL(noise).then(result=>{
          if(revision!==this.noiseRevision)return;
          this.noiseURL=result.url;sync.style(this.grain,{backgroundImage:`url("${result.url}")`});
        });
      }
      await this.noisePending;
    }
  }
  rgb(x:number,y:number){const i=(y*this.pixels!.width+x)*4,d=this.pixels!.data;return d[i+3]===255?`rgb(${d[i]} ${d[i+1]} ${d[i+2]})`:`rgb(${d[i]} ${d[i+1]} ${d[i+2]} / ${d[i+3]/255})`;}
  dispose(){this.noiseRevision++;this.updateRevision++;this.renderer.removeSurface(this.element);this.filter.remove();this.crop.remove();this.tintFilter.remove();this.directionalFilter.remove();this.noiseColorFilter.remove();}
}

type DOMObjectConstructor=new(renderer:DOMRenderer,node:Entity)=>RenderObject;
interface DOMRecord {object:RenderObject;Handler:DOMObjectConstructor;layout:string}
export class DOMRenderer {
  readonly kind="dom";
  readonly displayName="DOM · CSS / SVG";
  readonly sync=new DOMSync();
  readonly depth=new DOMPlanarDepth();
  private readonly transitions=new DOMTransitions(this);
  private readonly frame=new DOMViewportFrame(this);
  private vignetteKey="";
  private cameraBlurFilter?:SVGFilterElement;
  private cameraBlur?:SVGFEGaussianBlurElement;
  private viewMatrix=M.identity();private updateRevision=0;
  private readonly depths=new Map<HTMLDivElement,{depth:number;order:number;tie:number}>();private depthDirty=false;private depthCommitQueued=false;
  private readonly surfaces=new Set<HTMLDivElement>();
  private readonly records=new Map<string,Map<ComponentType,DOMRecord>>();
  readonly viewport:HTMLElement;readonly registry:Map<ComponentType,DOMObjectConstructor>;objects:RenderObject[];
  resources!:Resources;world!:HTMLDivElement;definitionSVG!:SVGSVGElement;defs!:SVGDefsElement;screen!:HTMLDivElement;screenFill!:HTMLDivElement;
  particleGlow!:DOMParticleGlow;private preparationScene?:Scene;
  constructor(viewport:HTMLElement){this.viewport=viewport;this.registry=new Map<ComponentType,DOMObjectConstructor>([["SpriteNumberRenderer",DOMNumber],["SpriteRenderer",Sprite],["TiledSpriteRenderer",TiledSprite],["CylindricalSpriteRenderer",DOMCylinder],["ParticleEmitter",DOMParticles],["PlaneRenderer",DOMPlane],["LineRenderer",DOMLine]]);this.objects=[];}
  createSurface(id:string,type:ComponentType):HTMLDivElement {
    // Hierarchy and component ownership live in Scene/records. Render surfaces
    // are siblings and receive camera-relative world matrices directly.
    const element=div("component",this.transitions.parent(id)||this.world);element.dataset.entity=id;element.dataset.component=type;this.sync.hidden(element,true);this.surfaces.add(element);return element;
  }
  viewDepth(scene:Scene,id:string,point:Vec3):number {
    return M.point(this.viewMatrix,M.point(scene.world.get(id)!,point)).z;
  }
  planeDepth(scene:Scene,id:string,bounds:Bounds,offsetZ=0):number {
    const camera=scene.requireComponent(scene.cameraNode.id,"Camera");
    const center=this.viewDepth(scene,id,{x:(bounds.left+bounds.right)/2,y:(bounds.bottom+bounds.top)/2,z:offsetZ});
    if(camera.projection!=="perspective")return center;
    const depths=[bounds.left,bounds.right].flatMap(x=>[bounds.bottom,bounds.top].map(y=>this.viewDepth(scene,id,{x,y,z:offsetZ})));
    const near=Math.max(camera.near,Math.min(...depths)),far=Math.min(camera.far,Math.max(...depths));
    // A frustum-covering rectangle can have its center beyond the far plane.
    // Rank its visible depth interval, not that off-screen rectangle center.
    return near<=far?(near+far)/2:center;
  }
  setDepth(element:HTMLDivElement,depth:number,order=0,tie=0):void {
    const previous=this.depths.get(element);if(previous?.depth===depth&&previous.order===order&&previous.tie===tie)return;
    if(previous){previous.depth=depth;previous.order=order;previous.tie=tie;}else this.depths.set(element,{depth,order,tie});this.depthDirty=true;
    // Resource preparation on another object must not postpone visible depth.
    if(!this.depthCommitQueued){this.depthCommitQueued=true;queueMicrotask(()=>{this.depthCommitQueued=false;this.commitDepths();});}
  }
  removeSurface(element:HTMLDivElement):void {
    if(this.depths.delete(element))this.depthDirty=true;
    this.surfaces.delete(element);
    element.remove();
  }
  private commitDepths():void {
    if(!this.depthDirty)return;
    // Like Babylon's transparent planes, composite far-to-near in view space.
    // Stable ranks retain additive blending without Gecko's preserve-3d / blend
    // flattening bug. Changing depth never reparents or recreates a surface.
    const opaque=(element:HTMLDivElement)=>this.depth.opaque.has(element.dataset.entity!);
    const ordered=[...this.depths].sort((a,b)=>Number(opaque(b[0]))-Number(opaque(a[0]))||b[1].depth-a[1].depth||a[1].order-b[1].order||a[1].tie-b[1].tie);
    ordered.forEach(([element],index)=>this.sync.style(element,{zIndex:index}));
    this.depthDirty=false;
  }
  async createScene(scene:Scene,resources:Resources){
    this.preparationScene=scene;this.particleGlow=new DOMParticleGlow(resources);
    this.resources=resources;this.world=div("scene-world",this.viewport);this.definitionSVG=svg("svg",{class:"filter-definitions","aria-hidden":"true"},this.viewport);this.defs=svg("defs",{},this.definitionSVG);
    this.cameraBlurFilter=svg("filter",{id:`camera-blur-${++serial}`,filterUnits:"userSpaceOnUse","color-interpolation-filters":"sRGB"},this.defs);
    this.cameraBlur=svg("feGaussianBlur",{stdDeviation:"0 0"},this.cameraBlurFilter);
    this.screen=div("screen-effect",this.viewport);this.screen.dataset.component="Vignette";this.screenFill=div("screen-effect",this.screen);
    this.reconcile(scene);
  }
  prepare(progress:LoadingProgress):Promise<void>{return this.particleGlow.prepare(this.preparationScene!,progress);}
  private reconcile(scene:Scene):void {
    let changed=false;
    for(const [id,records] of this.records)if(!scene.nodes.has(id)){for(const record of records.values())record.object.dispose();this.records.delete(id);changed=true;}
    for(const node of scene.nodes.values()){
      let records=this.records.get(node.id);if(!records)this.records.set(node.id,records=new Map());
      for(const [type,record] of records)if(!scene.component(node.id,type)||!this.registry.has(type)){record.object.dispose();records.delete(type);changed=true;}
      for(const [type,Handler] of this.registry){
        if(!scene.component(node.id,type))continue;
        const layout=type==="SpriteRenderer"?["DropShadow","Glow","ProceduralNoise"].filter(effect=>node.components.some(c=>c.type===effect)).join(","):type==="ParticleEmitter"?["Glow","ParticleMotionBlur"].filter(effect=>node.components.some(c=>c.type===effect)).join(","):type==="PlaneRenderer"?node.components.filter(c=>c.type==="ProceduralNoise").map(c=>c.type).join(","):"";
        const previous=records.get(type);
        if(previous?.Handler===Handler&&previous.layout===layout)continue;
        previous?.object.dispose();records.set(type,{Handler,layout,object:new Handler(this,node)});changed=true;
      }
    }
    if(changed)this.objects=[...this.records.values()].flatMap(records=>[...records.values()].map(record=>record.object));
  }
  async update(scene:Scene,view:View){
    const sync=this.sync;
    const revision=++this.updateRevision;this.viewMatrix=M.inverse(scene.world.get(scene.cameraNode.id)!);
    const blur=scene.component(scene.cameraNode.id,"GaussianBlur"),sx=blur?.enabled?blur.sigmaWorld.x*view.pixelsPerUnit:0,sy=blur?.enabled?blur.sigmaWorld.y*view.pixelsPerUnit:0;
    if(sx>0||sy>0){
      sync.attrs(this.cameraBlurFilter!,{x:-4*sx,y:-4*sy,width:view.width+8*sx,height:view.height+8*sy});
      sync.attribute(this.cameraBlur!,"stdDeviation",`${sx} ${sy}`);
    }
    sync.style(this.world,{filter:sx>0||sy>0?`url(#${this.cameraBlurFilter!.id})`:"none"});
    this.reconcile(scene);
    // Install masks before an async image/filter update can expose a surface.
    // Ownership includes surfaces which have never acquired a depth rank yet.
    for(const surface of this.surfaces)if(!scene.active.get(surface.dataset.entity!))sync.hidden(surface,true);
    this.transitions.update(transitionGroups(scene,view),this.surfaces,view,scene);
    const oldOpaque=[...this.depth.opaque].join("\n");
    await this.depth.update(scene,this.resources);if(revision!==this.updateRevision)return;
    if(oldOpaque!==[...this.depth.opaque].join("\n"))this.depthDirty=true;
    const updates=this.objects.map(object=>object.update(scene,view));
    const v=scene.component(scene.cameraNode.id,"Vignette");
    const camera=scene.requireComponent(scene.cameraNode.id,"Camera");
    sync.hidden(this.screen,!enabled(v)||v.depth!==null&&(v.depth<camera.near||v.depth>camera.far));
    if(v){
      const depth=v.depth,placed=depth!==null;
      const parent=placed?this.world:this.viewport;if(this.screen.parentElement!==parent)parent.append(this.screen);
      if(placed)this.setDepth(this.screen,depth);
      else {if(this.depths.delete(this.screen))this.depthDirty=true;sync.style(this.screen,{zIndex:"auto"});}
      const projectionOffset=scene.projectionOffset,projectionScale=placed?scene.frustumScale(depth):1;
      sync.attribute(this.screen,"class",placed?"component":"screen-effect");sync.style(this.screen,{transform:placed?scene.cssMatrix(scene.cameraNode.id,view,{x:-projectionOffset.x*projectionScale,y:-projectionOffset.y*projectionScale,z:depth}):"none"});
      const scale=placed?scene.frustumScale(depth):1,width=view.width*scale,height=view.height*scale;
      sync.style(this.screenFill,placed?{right:"auto",bottom:"auto",left:`${-width/2}px`,top:`${-height/2}px`,width:`${width}px`,height:`${height}px`}:{right:"0",bottom:"0",left:"0",top:"0",width:"100%",height:"100%"});
      const key=JSON.stringify([v.centerViewport,v.quadratic,v.quartic,v.verticalWeight,width,height]);
      if(key!==this.vignetteKey){this.vignetteKey=key;
      const radius=1.5,stops=Array.from({length:129},(_,i)=>{const r2=(radius*i/128)**2;return `rgb(0 0 0 / ${1-Math.exp(-v.quadratic*r2-v.quartic*r2*r2)}) ${i/128*100}%`;});
      sync.style(this.screenFill,{backgroundImage:`radial-gradient(ellipse ${radius*width/2}px ${radius*height/(2*v.verticalWeight)}px at ${v.centerViewport.x*100}% ${(1-v.centerViewport.y)*100}%,${stops.join(",")})`});
      }
    }
    this.frame.update(scene,view);
    await Promise.all(updates);
    if(revision===this.updateRevision)this.commitDepths();
  }
  disposeScene(){this.updateRevision++;this.vignetteKey="";this.objects.forEach(o=>o.dispose());this.objects=[];this.transitions.dispose();this.frame.dispose();this.records.clear();this.surfaces.clear();this.depths.clear();this.depth.clear();this.depthDirty=false;this.world?.remove();this.screen?.remove();this.definitionSVG?.remove();this.particleGlow?.dispose();this.preparationScene=undefined;}
  dispose(){this.disposeScene();}
}
