import type {View} from './types.js';
import type {SpriteFocus} from './depth-of-field.js';
import type {DOMSync} from './dom-sync.js';
interface Layer {mask:HTMLDivElement;blur:HTMLDivElement;image:HTMLImageElement}
/** Plane-depth Gaussian blur, evaluated after perspective. Each retained layer
 * covers a bounded visible region and carries a CSS gradient weight. */
export class DOMSpriteFocus {
  private readonly layers:Layer[]=[];
  private levels:number[]=[];
  private limit=-1;
  apply(sync:DOMSync,parent:HTMLDivElement,body:HTMLImageElement,focus:SpriteFocus|null,view:View,matrix:string,clip:string):void {
    if(!focus){for(const layer of this.layers)if(layer)sync.hidden(layer.mask,true);sync.hidden(body,false);return;}
    if(this.limit!==focus.maxSigmaWorld){this.limit=focus.maxSigmaWorld;this.levels=[0];for(let v=.005;v<this.limit;v*=2)this.levels.push(v);this.levels.push(this.limit);for(let i=this.levels.length;i<this.layers.length;i++)if(this.layers[i])sync.hidden(this.layers[i].mask,true);}
    const f=focus.blurField,ppu=view.pixelsPerUnit,a=f.x,b=f.y,constant=f.z*ppu,g=Math.hypot(a,b),bounds=focus.screenBounds;
    const reach=Math.ceil(3*Math.min(focus.maxSigmaWorld*ppu,Math.abs(constant)+Math.abs(a)*view.width/2+Math.abs(b)*view.height/2)+2);
    // Offscreen artwork can still contribute a blurred edge to the viewport.
    let left=Math.max(-view.width/2-reach,bounds?bounds.left*ppu:-Infinity),right=Math.min(view.width/2+reach,bounds?bounds.right*ppu:Infinity),top=Math.max(-view.height/2-reach,bounds?-bounds.top*ppu:-Infinity),bottom=Math.min(view.height/2+reach,bounds?-bounds.bottom*ppu:Infinity);
    if(left>=right||top>=bottom){for(const layer of this.layers)if(layer)sync.hidden(layer.mask,true);sync.hidden(body,true);return;}
    const values=[a*left+b*top+constant,a*right+b*top+constant,a*right+b*bottom+constant,a*left+b*bottom+constant],minValue=Math.min(...values),maxValue=Math.max(...values);
    const max=Math.min(focus.maxSigmaWorld*ppu,Math.max(Math.abs(minValue),Math.abs(maxValue))),min=minValue<=0&&maxValue>=0?0:Math.min(focus.maxSigmaWorld*ppu,Math.abs(minValue),Math.abs(maxValue)),padding=Math.ceil(3*max+2);
    left=Math.floor(left-padding);right=Math.ceil(right+padding);top=Math.floor(top-padding);bottom=Math.ceil(bottom+padding);
    const w=right-left,h=bottom-top,c=constant+a*(left+right)/2+b*(top+bottom)/2;
    sync.style(parent,{transform:'none',clipPath:'none',isolation:'isolate',width:'0px',height:'0px'});sync.hidden(body,true);
    const nx=g>1e-12?a/g:0,ny=g>1e-12?b/g:1,length=Math.abs(nx)*w+Math.abs(ny)*h,angle=Math.atan2(nx,-ny)*180/Math.PI;
    for(let i=0;i<this.levels.length;i++){
      const sigma=this.levels[i]*ppu,lo=(this.levels[i-1]??0)*ppu,hi=(this.levels[i+1]??this.levels[i])*ppu;
      if(lo>max||hi<min){if(this.layers[i])sync.hidden(this.layers[i].mask,true);continue;}
      let layer=this.layers[i];
      if(!layer){const mask=document.createElement('div'),blur=document.createElement('div'),image=new Image();image.alt='';mask.append(blur);blur.append(image);parent.append(mask);layer={mask,blur,image};this.layers[i]=layer;}
      sync.hidden(layer.mask,false);
      const weight=(value:number)=>{const x=Math.abs(value);return x<=sigma?(sigma===lo?1:Math.max(0,(x-lo)/(sigma-lo))):(hi===sigma?1:Math.max(0,(hi-x)/(hi-sigma)));};
      const points=[-hi,-sigma,-lo,lo,sigma,hi].filter((v,j,all)=>all.indexOf(v)===j).sort((x,y)=>x-y);
      const gradient=g<1e-12?`linear-gradient(rgba(0,0,0,${weight(c)}),rgba(0,0,0,${weight(c)}))`:`linear-gradient(${angle}deg,${points.map(v=>`rgba(0,0,0,${weight(v)}) ${(v-c)/g+length/2}px`).join(',')})`;
      sync.style(layer.mask,{position:'absolute',left:`${left}px`,top:`${top}px`,width:`${w}px`,height:`${h}px`,maskImage:gradient,mixBlendMode:'plus-lighter',pointerEvents:'none'});
      sync.style(layer.blur,{position:'absolute',left:'0px',top:'0px',width:`${w}px`,height:`${h}px`,overflow:'clip',contain:'paint',filter:sigma>0?`blur(${sigma}px)`:'none'});
      if(layer.image.src!==body.src)layer.image.src=body.src;
      sync.style(layer.image,{position:'absolute',left:`${-left}px`,top:`${-top}px`,width:body.style.width,height:body.style.height,imageRendering:body.style.imageRendering,filter:body.style.filter,maskImage:body.style.maskImage,clipPath:clip,transform:matrix,transformOrigin:'0px 0px'});
    }
  }
}
