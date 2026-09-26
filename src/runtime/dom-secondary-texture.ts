import type {DOMSync} from "./dom-sync.js";
import type {SecondaryTexture,Vec2} from "./types.js";

const NS="http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>,parent:Element):SVGElementTagNameMap[K]{
  const element=document.createElementNS(NS,tag);
  for(const [key,value]of Object.entries(attrs))element.setAttribute(key,String(value));
  parent.append(element);return element;
}

/** One retained SVG filter; UV/opacity edits never generate another image. */
export class DOMSecondaryTexture {
  readonly definition:SVGFilterElement;
  readonly url:string;
  private readonly image:SVGFEImageElement;
  private readonly tiles:SVGFETileElement;
  private readonly alpha:SVGFEFuncAElement;
  constructor(defs:SVGDefsElement,id:string){
    this.definition=svg("filter",{id,filterUnits:"userSpaceOnUse","color-interpolation-filters":"sRGB"},defs);
    this.url=`url(#${id})`;
    this.image=svg("feImage",{result:"tile",preserveAspectRatio:"none","image-rendering":"optimizeSpeed"},this.definition);
    this.tiles=svg("feTile",{in:"tile",result:"pattern"},this.definition);
    const transfer=svg("feComponentTransfer",{in:"pattern",result:"overlay"},this.definition);
    this.alpha=svg("feFuncA",{type:"linear",slope:1},transfer);
    svg("feColorMatrix",{in:"SourceGraphic",values:"1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1",result:"opaqueArt"},this.definition);
    svg("feComposite",{in:"overlay",in2:"opaqueArt",operator:"over",result:"textured"},this.definition);
    svg("feComposite",{in:"textured",in2:"SourceAlpha",operator:"in"},this.definition);
  }
  update(sync:DOMSync,c:SecondaryTexture,source:string,origin:Vec2,units:number,width:number,height:number):void{
    const w=c.worldSize.x*units,h=c.worldSize.y*units;
    const phase=(value:number,period:number)=>((value%period)+period)%period-period;
    const x=phase((c.origin.x-origin.x)*units,w),y=phase((origin.y-c.origin.y)*units,h);
    sync.attrs(this.image,{href:source,x,y,width:w,height:h});
    sync.attrs(this.definition,{x,y,width:Math.max(width,x+w)-x,height:Math.max(height,y+h)-y});
    sync.attrs(this.tiles,{x:0,y:0,width,height});sync.attribute(this.alpha,"slope",c.opacity);
  }
  dispose():void{this.definition.remove();}
}
