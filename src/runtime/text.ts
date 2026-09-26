import type {Scene} from "./scene.js";
import type {Bounds,TextRenderer} from "./types.js";

const NS="http://www.w3.org/2000/svg",EM=1024;
let serial=0;
interface LineMetrics {width:number;left:number;right:number;top:number;bottom:number}
/** Shared webfont and browser metrics. SVG measures only changed text; the
 * DOM backend never needs a canvas. */
export class PreparedFont {
  private svg?:SVGSVGElement;private text?:SVGTextElement;
  private readonly measurements=new Map<string,LineMetrics>();
  constructor(readonly family:string,readonly face:FontFace,readonly ascent:number){}
  measure(value:string,tracking:number):LineMetrics {
    const key=JSON.stringify([value,tracking]);const cached=this.measurements.get(key);if(cached)return cached;
    if(!this.svg){
      this.svg=document.createElementNS(NS,"svg");this.text=document.createElementNS(NS,"text");
      this.svg.setAttribute("aria-hidden","true");this.svg.style.cssText="position:fixed;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none;left:0;top:0";
      this.text.style.fontFamily=`"${this.family}"`;this.text.style.fontSize=`${EM}px`;this.text.style.fontKerning="none";this.text.style.fontVariantLigatures="none";this.text.style.whiteSpace="pre";
      this.svg.append(this.text);document.body.append(this.svg);
    }
    const text=this.text!;text.style.letterSpacing=`${tracking*EM}px`;text.textContent=value;
    const b=text.getBBox(),metrics={width:Math.max(0,text.getComputedTextLength()/EM-(value?tracking:0)),left:b.x/EM,right:(b.x+b.width)/EM,top:b.y/EM,bottom:(b.y+b.height)/EM};
    if(this.measurements.size>=256)this.measurements.delete(this.measurements.keys().next().value!);
    this.measurements.set(key,metrics);return metrics;
  }
  dispose():void{document.fonts.delete(this.face);this.svg?.remove();this.measurements.clear();}
}

/** FontFace registrations are scene-owned and loaded during preparation. */
export class FontResources {
  private readonly pending=new Map<string,Promise<PreparedFont>>();
  private readonly registered=new Set<PreparedFont>();
  private readonly ready=new Set<string>();private disposed=false;
  isReady(id:string):boolean{return this.ready.has(id);}
  load(scene:Scene,id:string):Promise<PreparedFont>{
    const asset=scene.fontAsset(id),source=scene.source(id),key=JSON.stringify([source,asset.ascent]);
    let pending=this.pending.get(key);
    if(!pending){
      pending=(async()=>{
        const family=`scene-font-${++serial}`,face=new FontFace(family,`url(${JSON.stringify(source)})`,{style:"normal",weight:"400",display:"block"});
        await face.load();if(this.disposed)throw new Error("Font resources have been disposed.");
        document.fonts.add(face);const font=new PreparedFont(family,face,asset.ascent);this.registered.add(font);return font;
      })();this.pending.set(key,pending);
    }
    return pending;
  }
  async prepare(scene:Scene,id:string):Promise<void>{await this.load(scene,id);if(!this.disposed)this.ready.add(id);}
  dispose():void{this.disposed=true;for(const font of this.registered)font.dispose();this.registered.clear();this.pending.clear();this.ready.clear();}
}

export interface TextLayout {bounds:Bounds;lines:{text:string;left:number;top:number}[];visible:boolean}
/** Origin is the top of the first EM line, sizes and tracking are local units. */
export function textLayout(c:TextRenderer,font:PreparedFont):TextLayout {
  const lines:TextLayout["lines"]=[],bounds:Bounds={left:Infinity,right:-Infinity,bottom:Infinity,top:-Infinity};
  let visible=false;
  for(const [index,text]of c.text.replace(/\t/g,"    ").split("\n").entries()){
    const m=font.measure(text,c.letterSpacing/c.fontSize),width=m.width*c.fontSize;
    const left=c.alignment==="left"?0:c.alignment==="center"?-width/2:-width,top=index*c.lineHeight*c.fontSize;
    lines.push({text,left,top});if(!text.trim())continue;visible=true;
    const baseline=top+font.ascent*c.fontSize;
    bounds.left=Math.min(bounds.left,left+m.left*c.fontSize);bounds.right=Math.max(bounds.right,left+m.right*c.fontSize);
    bounds.top=Math.max(bounds.top,-baseline-m.top*c.fontSize);bounds.bottom=Math.min(bounds.bottom,-baseline-m.bottom*c.fontSize);
  }
  if(!visible)Object.assign(bounds,{left:0,right:0,bottom:0,top:0});
  return {bounds,lines,visible};
}
