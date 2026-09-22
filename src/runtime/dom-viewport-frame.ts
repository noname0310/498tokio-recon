import type {DOMRenderer} from "./dom.js";
import type {Scene} from "./scene.js";
import type {Color,View} from "./types.js";
import {roundedAperturePath,viewportFrameLayout} from "./viewport-frame.js";

const NS="http://www.w3.org/2000/svg";
let serial=0;
const color=(c:Color)=>`rgb(${c.r*255} ${c.g*255} ${c.b*255})`;

export class DOMViewportFrame {
  private element?:SVGSVGElement;
  private aperture?:SVGPathElement;
  private shadow?:SVGPathElement;
  private border?:SVGPathElement;
  private key="";
  constructor(private readonly renderer:DOMRenderer){}
  update(scene:Scene,view:View):void {
    const c=scene.component(scene.cameraNode.id,"ViewportFrame"),sync=this.renderer.sync;
    if(!c?.enabled){if(this.element)sync.hidden(this.element,true);return;}
    if(!this.element){
      const root=this.element=document.createElementNS(NS,"svg");root.classList.add("screen-effect");root.dataset.component="ViewportFrame";root.setAttribute("aria-hidden","true");root.setAttribute("preserveAspectRatio","none");
      const defs=document.createElementNS(NS,"defs"),clip=document.createElementNS(NS,"clipPath");clip.id=`viewport-frame-${++serial}`;clip.setAttribute("clipPathUnits","userSpaceOnUse");
      this.aperture=document.createElementNS(NS,"path");clip.append(this.aperture);defs.append(clip);
      this.shadow=document.createElementNS(NS,"path");this.shadow.setAttribute("fill-rule","evenodd");this.shadow.setAttribute("clip-path",`url(#${clip.id})`);
      this.border=document.createElementNS(NS,"path");this.border.setAttribute("fill-rule","evenodd");root.append(defs,this.shadow,this.border);this.renderer.viewport.append(root);
    }
    sync.hidden(this.element,false);sync.attribute(this.element,"data-entity",scene.cameraNode.id);
    const layout=viewportFrameLayout(c,view),key=JSON.stringify([layout,c.color,c.innerShadow.color,c.innerShadow.opacity]);
    if(this.key===key)return;this.key=key;
    const {width,height,aperture,radius,offset}=layout;
    // Letterboxing can place the viewport on fractional CSS pixels. Extend the
    // outer fill past its clip so SVG edge antialiasing cannot leak scene colors
    // through the last border pixel. The measured aperture stays unchanged.
    const padding=1;
    sync.style(this.element,{left:`${-padding}px`,top:`${-padding}px`,width:`${width+2*padding}px`,height:`${height+2*padding}px`});
    sync.attribute(this.element,"viewBox",`${-padding} ${-padding} ${width+2*padding} ${height+2*padding}`);
    const outside=`M${-padding} ${-padding}H${width+padding}V${height+padding}H${-padding}Z`,hole=roundedAperturePath(aperture,radius);
    sync.attribute(this.aperture!,"d",hole);sync.attribute(this.border!,"d",outside+hole);
    // An inset shadow is the part of the aperture not covered by its translated
    // copy. This preserves the one shared opacity where its two bands meet.
    sync.attribute(this.shadow!,"d",outside+roundedAperturePath({...aperture,x:aperture.x+offset.x,y:aperture.y+offset.y},radius));
    sync.attribute(this.border!,"fill",color(c.color));sync.attribute(this.border!,"fill-opacity",c.color.a);
    sync.attribute(this.shadow!,"fill",color(c.innerShadow.color));sync.attribute(this.shadow!,"fill-opacity",c.innerShadow.color.a*c.innerShadow.opacity);
  }
  dispose():void {this.element?.remove();this.element=undefined;this.aperture=undefined;this.shadow=undefined;this.border=undefined;this.key="";}
}
