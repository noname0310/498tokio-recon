import type {DOMRenderer} from "./dom.js";
import type {Scene} from "./scene.js";
import type {View} from "./types.js";
import {scanlinePhase,scanlineRows} from "./scanline-jitter.js";

const NS="http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>,parent:Element):SVGElementTagNameMap[K] {
  const element=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))element.setAttribute(k,String(v));parent.append(element);return element;
}
interface NoiseLayer {merge:SVGFEMergeElement;images:SVGFEImageElement[];inputs:SVGFEMergeNodeElement[]}
let serial=0;
/** Retained filter graph: one decoded strip, no per-frame DOM or image uploads. */
export class DOMScanlineJitter {
  private readonly filter:SVGFilterElement;private readonly layers:NoiseLayer[]=[];
  private readonly blend:SVGFECompositeElement;private readonly neutral:SVGFEColorMatrixElement;
  private readonly tiles:SVGFETileElement;
  private readonly shifts:SVGFEDisplacementMapElement[];private readonly output:SVGFECompositeElement;
  private readonly body:SVGFEOffsetElement;private readonly edges:SVGFEOffsetElement[];private readonly extensions:SVGFETileElement[];private readonly source:SVGFEMergeElement;
  private seed?:number;private url="";private revision=0;
  constructor(private readonly renderer:DOMRenderer){
    this.filter=svg("filter",{id:`camera-jitter-${++serial}`,filterUnits:"userSpaceOnUse",primitiveUnits:"userSpaceOnUse","color-interpolation-filters":"sRGB"},renderer.defs);
    this.body=svg("feOffset",{in:"SourceGraphic",dx:0,dy:0,result:"body"},this.filter);
    this.edges=[];this.extensions=[];
    for(let i=0;i<2;i++){
      this.edges.push(svg("feOffset",{in:"body",dx:0,dy:0,result:`edge${i}`},this.filter));
      this.extensions.push(svg("feTile",{in:`edge${i}`,result:`extension${i}`},this.filter));
    }
    this.source=svg("feMerge",{result:"clamped"},this.filter);
    for(const input of ["extension0","extension1","body"])svg("feMergeNode",{in:input},this.source);
    for(let i=0;i<2;i++)this.layers.push({merge:svg("feMerge",{result:`noise${i}`},this.filter),images:[],inputs:[]});
    this.blend=svg("feComposite",{in:"noise0",in2:"noise1",operator:"arithmetic",k1:0,k2:1,k3:0,k4:0,result:"mixed"},this.filter);
    // A stored byte cannot represent exactly 0.5. Set the vertical channel
    // explicitly, instead of accidentally introducing a vertical displacement.
    this.neutral=svg("feColorMatrix",{in:"mixed",values:"1 0 0 0 0 0 1 0 0 0 0 0 0 0 .5 0 0 0 0 1",result:"noiseStrip"},this.filter);
    this.tiles=svg("feTile",{in:"noiseStrip",result:"noise"},this.filter);
    this.shifts=["R","G"].map((channel,i)=>svg("feDisplacementMap",{in:"clamped",in2:"noise",xChannelSelector:channel,yChannelSelector:"B",scale:0,result:`shift${i}`},this.filter));
    this.output=svg("feComposite",{in:"shift0",in2:"shift1",operator:"arithmetic",k1:0,k2:.5,k3:.5,k4:0},this.filter);
  }
  async update(scene:Scene,view:View):Promise<string|null> {
    const revision=++this.revision,c=scene.component(scene.cameraNode.id,"ScanlineJitter");
    if(!c?.enabled||c.amplitudeWorld<=0)return null;
    if(this.seed!==c.seed){
      const url=await this.renderer.resources.scanlineURL(c.seed);if(revision!==this.revision)return null;
      this.seed=c.seed;this.url=url;
    }
    const sync=this.renderer.sync,phase=scanlinePhase(c,scene.timelineTime);
    const line=c.lineHeightWorld*view.pixelsPerUnit,tileHeight=line*scanlineRows,padding=Math.ceil(c.amplitudeWorld*view.pixelsPerUnit)+1;
    const bounds={x:-padding,y:0,width:view.width+2*padding,height:view.height};
    const strip={x:0,y:0,width:1/view.dpr,height:view.height};
    sync.attrs(this.filter,bounds);
    sync.attrs(this.body,{x:0,y:0,width:view.width,height:view.height});sync.attrs(this.source,bounds);
    // Duplicate the two boundary columns, matching the shader's clamp sampler.
    // Only the thin strips are repeated; the DOM scene is never duplicated.
    for(let i=0;i<2;i++){
      sync.attrs(this.edges[i],{x:i===0?0:view.width-1/view.dpr,y:0,width:1/view.dpr,height:view.height});
      sync.attrs(this.extensions[i],{x:i===0?-padding:view.width,y:0,width:padding,height:view.height});
    }
    for(const [i,layer]of this.layers.entries()){
      const count=Math.ceil(view.height/tileHeight)+1;
      while(layer.images.length<count){
        const key=`strip${i}-${layer.images.length}`,image=svg("feImage",{result:key,preserveAspectRatio:"none","image-rendering":"pixelated"},this.filter);
        this.filter.insertBefore(image,layer.merge);layer.images.push(image);layer.inputs.push(svg("feMergeNode",{in:key},layer.merge));
      }
      while(layer.images.length>count){layer.images.pop()!.remove();layer.inputs.pop()!.remove();}
      const origin=view.height/2-(i===0?phase.first:phase.second)*line;
      const start=origin+Math.floor(-origin/tileHeight)*tileHeight;
      for(let j=0;j<count;j++)sync.attrs(layer.images[j],{href:this.url,x:0,y:start+j*tileHeight,width:strip.width,height:tileHeight});
      sync.attrs(layer.merge,strip);
    }
    sync.attrs(this.blend,{...strip,k2:1-phase.mix,k3:phase.mix});sync.attrs(this.neutral,strip);sync.attrs(this.tiles,bounds);
    for(const shift of this.shifts)sync.attrs(shift,{...bounds,scale:2*c.amplitudeWorld*view.pixelsPerUnit});
    sync.attrs(this.output,{x:0,y:0,width:view.width,height:view.height});
    return `url(#${this.filter.id})`;
  }
  dispose():void {this.revision++;this.filter.remove();}
}
