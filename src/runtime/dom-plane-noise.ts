import type {DOMRenderer} from "./dom.js";
import type {Bounds,ComponentMap} from "./types.js";
const NS="http://www.w3.org/2000/svg";
let serial=0;
/** A retained SVG filter multiplies RGB and preserves the plane/mask alpha. */
export class DOMPlaneNoise {
  readonly filter=document.createElementNS(NS,"filter");
  readonly image=document.createElementNS(NS,"feImage");
  readonly channels=[document.createElementNS(NS,"feFuncR"),document.createElementNS(NS,"feFuncG"),document.createElementNS(NS,"feFuncB")];
  private key="";private url="";private revision=0;private pending:Promise<void>=Promise.resolve();
  private updateRevision=0;
  constructor(readonly renderer:DOMRenderer){
    const f=this.filter;f.id=`plane-noise-${++serial}`;f.setAttribute("filterUnits","userSpaceOnUse");f.setAttribute("color-interpolation-filters","sRGB");
    this.image.setAttribute("preserveAspectRatio","none");this.image.setAttribute("result","grainTile");f.append(this.image);
    const tile=document.createElementNS(NS,"feTile");tile.setAttribute("in","grainTile");tile.setAttribute("result","grain");f.append(tile);
    const transfer=document.createElementNS(NS,"feComponentTransfer");transfer.setAttribute("in","grain");transfer.setAttribute("result","coloredGrain");transfer.append(...this.channels);f.append(transfer);
    const opaque=document.createElementNS(NS,"feColorMatrix");opaque.setAttribute("in","SourceGraphic");opaque.setAttribute("values","1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1");opaque.setAttribute("result","opaque");f.append(opaque);
    const mul=document.createElementNS(NS,"feComposite");mul.setAttribute("in","opaque");mul.setAttribute("in2","coloredGrain");mul.setAttribute("operator","arithmetic");mul.setAttribute("k1","2");mul.setAttribute("result","textured");f.append(mul);
    const alpha=document.createElementNS(NS,"feComposite");alpha.setAttribute("in","textured");alpha.setAttribute("in2","SourceAlpha");alpha.setAttribute("operator","in");f.append(alpha);renderer.defs.append(f);
  }
  async update(element:HTMLElement,b:Bounds,u:number,c:ComponentMap["ProceduralNoise"]|undefined):Promise<void>{
    const current=++this.updateRevision;
    const sync=this.renderer.sync,enabled=c?.enabled&&c.bands.some(b=>b.variance>0);sync.style(element,{filter:enabled&&this.url?`url(#${this.filter.id})`:"none"});if(!enabled||!c)return;
    const width=c.worldSize.x*u,height=c.worldSize.y*u,x0=b.left*u,y0=-b.top*u;
    const x=c.origin.x*u+Math.floor((x0-c.origin.x*u)/width)*width,y=-c.origin.y*u+Math.floor((y0+c.origin.y*u)/height)*height;
    sync.attrs(this.filter,{x:x-x0,y:y-y0,width:Math.max(b.right*u,x+width)-x,height:Math.max(-b.bottom*u,y+height)-y});sync.attrs(this.image,{x:x-x0,y:y-y0,width,height});
    for(const [i,gain] of [c.channelGain.r,c.channelGain.g,c.channelGain.b].entries())sync.attrs(this.channels[i],{type:"gamma",amplitude:2**(gain-1),exponent:gain,offset:0});
    const key=this.renderer.resources.noiseKey(c);
    if(key!==this.key){this.key=key;const revision=++this.revision;this.pending=this.renderer.resources.noiseURL(c).then(result=>{
      if(revision!==this.revision)return;
      this.url=result.url;sync.attribute(this.image,"href",result.url);
    });}
    await this.pending;
    if(current===this.updateRevision)sync.style(element,{filter:`url(#${this.filter.id})`});
  }
  dispose():void{this.revision++;this.updateRevision++;this.filter.remove();}
}
