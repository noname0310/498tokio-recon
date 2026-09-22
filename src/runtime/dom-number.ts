import type {DOMRenderer} from "./dom.js";
import type {Scene} from "./scene.js";
import type {Entity,View} from "./types.js";
import {numberLayout} from "./sprite-number.js";
const NS="http://www.w3.org/2000/svg";let serial=0;
function svg<K extends keyof SVGElementTagNameMap>(tag:K,parent:Element):SVGElementTagNameMap[K]{const e=document.createElementNS(NS,tag);parent.append(e);return e;}

/** One retained image per place, inside an unbounded SVG pattern. Updating a
 * Float32 track between integers never mutates a glyph or recreates the DOM. */
export class DOMNumber {
  readonly id:string;readonly element:HTMLDivElement;
  private readonly root:SVGSVGElement;private readonly pattern:SVGPatternElement;private readonly fill:SVGRectElement;
  private readonly filter:SVGFilterElement;private readonly tint:SVGFEColorMatrixElement;private readonly blur:SVGFEGaussianBlurElement;private readonly gain:SVGFEFuncAElement;
  private readonly images:SVGImageElement[]=[];private revision=0;
  constructor(readonly renderer:DOMRenderer,node:Entity){
    this.id=node.id;this.element=renderer.createSurface(node.id,"SpriteNumberRenderer");this.root=svg("svg",this.element);this.root.setAttribute("aria-hidden","true");this.root.style.overflow="visible";
    const defs=svg("defs",this.root),uid=`number-${++serial}`;
    this.pattern=svg("pattern",defs);this.pattern.id=uid;this.pattern.setAttribute("patternUnits","userSpaceOnUse");
    this.fill=svg("rect",this.root);this.fill.setAttribute("fill",`url(#${uid})`);
    this.filter=svg("filter",renderer.defs);this.filter.id=uid+"-filter";this.filter.setAttribute("color-interpolation-filters","sRGB");
    for(const [key,value] of Object.entries({x:"-50%",y:"-50%",width:"200%",height:"200%"}))this.filter.setAttribute(key,value);
    this.tint=svg("feColorMatrix",this.filter);this.tint.setAttribute("result","body");
    this.blur=svg("feGaussianBlur",this.filter);const transfer=svg("feComponentTransfer",this.filter);this.gain=svg("feFuncA",transfer);this.gain.setAttribute("type","linear");
    const merge=svg("feMerge",this.filter);svg("feMergeNode",merge);svg("feMergeNode",merge).setAttribute("in","body");
  }
  async update(scene:Scene,view:View):Promise<void>{
    const rev=++this.revision,r=this.renderer,s=r.sync,c=scene.requireComponent(this.id,"SpriteNumberRenderer");
    if(!scene.active.get(this.id)||!c.enabled||!c.color.a){s.hidden(this.element,true);return;}
    const asset=scene.asset(c.asset),layout=numberLayout(c,asset),bounds=c.repeatWorld?scene.coverage(this.id,view):layout.bounds;
    if(!bounds){s.hidden(this.element,true);return;}
    const frames=await r.resources.spriteFrames(scene,c.asset);if(rev!==this.revision)return;
    const u=asset.pixelsPerUnit,clip=scene.clipPlane(this.id,view,bounds,0,{x:0,y:0},u),b={x:bounds.left*u,y:-bounds.top*u,width:(bounds.right-bounds.left)*u,height:(bounds.top-bounds.bottom)*u};
    s.hidden(this.element,!clip.visible);s.style(this.element,{transform:scene.cssMatrix(this.id,view,{x:0,y:0,z:0},u),clipPath:clip.css});
    r.setDepth(this.element,r.viewDepth(scene,this.id,{x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2,z:0}));
    s.style(this.root,{position:"absolute",left:`${b.x}px`,top:`${b.y}px`,width:`${b.width}px`,height:`${b.height}px`});s.attribute(this.root,"viewBox",`${b.x} ${b.y} ${b.width} ${b.height}`);s.attrs(this.fill,b);
    s.attrs(this.pattern,{x:layout.left,y:0,width:c.repeatWorld?c.repeatWorld.x*u:layout.width,height:c.repeatWorld?c.repeatWorld.y*u:layout.height});
    while(this.images.length<layout.frames.length)this.images.push(svg("image",this.pattern));
    for(const [i,image]of this.images.entries()){
      s.style(image,{display:i>=layout.frames.length?"none":""});if(i>=layout.frames.length)continue;
      s.attrs(image,{x:layout.starts[i],y:0,width:asset.atlas!.cellSize.x,height:asset.atlas!.cellSize.y,href:frames[layout.frames[i]].src,"preserveAspectRatio":"none"});s.style(image,{imageRendering:"crisp-edges"});
    }
    s.attribute(this.element,"data-text",layout.text);
    const tint=c.color,glow=scene.component(this.id,"Glow");
    s.attribute(this.tint,"values",`${tint.r} 0 0 0 0 0 ${tint.g} 0 0 0 0 0 ${tint.b} 0 0 0 0 0 1 0`);
    s.attribute(this.blur,"stdDeviation",glow?.enabled?glow.sigmaWorld*u:0);s.attribute(this.gain,"slope",glow?.enabled?glow.intensity:0);
    s.style(this.root,{filter:`url(#${this.filter.id})`,opacity:String(tint.a)});
  }
  dispose():void{this.revision++;this.filter.remove();this.renderer.removeSurface(this.element);}
}
