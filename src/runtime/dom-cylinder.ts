import type {DOMRenderer} from "./dom.js";
import type {Scene} from "./scene.js";
import type {Entity,View} from "./types.js";
import {cylinderGeometryKey,cylinderLight,cylinderStrips,type CylinderStrip} from "./cylinder.js";
import {Math3D as M} from "./math.js";
const NS="http://www.w3.org/2000/svg";let serial=0;
export class DOMCylinder {
  readonly id:string;private readonly surfaces:{element:HTMLDivElement;fill:HTMLDivElement}[]=[];
  private strips:CylinderStrip[]=[];private geometryKey="";private sourceKey="";private revision=0;
  private readonly filter:SVGFilterElement;private readonly tint:SVGFEColorMatrixElement;
  constructor(readonly renderer:DOMRenderer,node:Entity){
    this.id=node.id;this.filter=document.createElementNS(NS,"filter");this.filter.id=`cylinder-tint-${++serial}`;this.filter.setAttribute("color-interpolation-filters","sRGB");this.tint=document.createElementNS(NS,"feColorMatrix");this.filter.append(this.tint);renderer.defs.append(this.filter);
  }
  async update(scene:Scene,view:View):Promise<void>{
    const revision=++this.revision,r=this.renderer,sync=r.sync,c=scene.requireComponent(this.id,"CylindricalSpriteRenderer");
    if(!c.enabled||!scene.active.get(this.id)||!r.resources.isImageReady(c.asset)||c.color.a===0){for(const s of this.surfaces)sync.hidden(s.element,true);return;}
    const source=scene.source(c.asset);if(this.sourceKey!==source){await r.resources.decodedImage(scene,c.asset);if(revision!==this.revision)return;this.sourceKey=source;}
    const key=cylinderGeometryKey(c);if(key!==this.geometryKey){this.geometryKey=key;this.strips=cylinderStrips(c);}
    while(this.surfaces.length<c.segments){const element=r.createSurface(this.id,"CylindricalSpriteRenderer"),fill=document.createElement("div");element.append(fill);this.surfaces.push({element,fill});}
    const asset=scene.asset(c.asset),scale=4,tw=asset.size.x*scale,th=asset.size.y*scale,width=tw/c.segments,height=(c.length.max-c.length.min)/c.tileLength*th;
    const rawPhase=(c.uvOffset.y-c.length.min/c.tileLength)*th-height,phase=((rawPhase%th)+th)%th;
    const color=c.color,tinted=color.r!==1||color.g!==1||color.b!==1;
    sync.attribute(this.tint,"values",`${color.r} 0 0 0 0 0 ${color.g} 0 0 0 0 0 ${color.b} 0 0 0 0 0 1 0`);
    const world=scene.world.get(this.id)!;
    for(const [i,surface]of this.surfaces.entries()){
      const {element,fill}=surface;sync.hidden(element,i>=c.segments);if(i>=c.segments)continue;
      const s=this.strips[i],matrix=M.multiply(world,s.matrix),units={x:width/s.width,y:th/c.tileLength,z:1};
      const css=scene.cssProjection(matrix,view,units);sync.style(element,{transform:`matrix3d(${css.join(",")})`,width:`${width+.002}px`,height:`${height}px`,overflow:"hidden"});
      const center=M.point(scene.viewMatrix,M.point(matrix,{x:s.width/2,y:-(c.length.max-c.length.min)/2,z:0}));r.setDepth(element,center.z);
      // Scroll a retained compositor layer. Animating background-position on
      // long perspective facets would repaint the whole cylinder each frame.
      // One guard repeat covers every wrapped phase of the flipped V axis.
      sync.style(fill,{position:"absolute",left:"0px",top:"0px",width:`${width+.002}px`,height:`${height+th}px`,backgroundImage:`url(${JSON.stringify(source)})`,backgroundRepeat:"repeat",backgroundSize:`${tw}px ${th}px`,backgroundPosition:`${-(s.u+c.uvOffset.x)*tw}px 0px`,imageRendering:asset.filter==="point"?"crisp-edges":"auto",transform:`translateY(${height+phase}px) scaleY(-1)`,transformOrigin:"0 0",willChange:"transform",opacity:color.a,filter:[tinted?`url(#${this.filter.id})`:"",`brightness(${cylinderLight(c,s.normal)})`].filter(Boolean).join(" ")});
    }
  }
  dispose():void{this.revision++;for(const s of this.surfaces)this.renderer.removeSurface(s.element);this.filter.remove();}
}
