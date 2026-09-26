import type {DOMRenderer} from "./dom.js";
import type {Scene} from "./scene.js";
import type {Entity,View} from "./types.js";
import {textLayout,type TextLayout} from "./text.js";
const NS="http://www.w3.org/2000/svg";

/** Retained SVG text nodes with a scene-scoped webfont; no canvas or baking. */
export class DOMText {
  readonly id:string;readonly element:HTMLDivElement;
  private readonly svg=document.createElementNS(NS,"svg");
  private readonly lines:SVGTextElement[]=[];
  private key="";private layout?:TextLayout;private revision=0;private disposed=false;
  constructor(readonly renderer:DOMRenderer,node:Entity){
    this.id=node.id;this.element=renderer.createSurface(node.id,"TextRenderer");this.element.append(this.svg);
    this.svg.style.overflow="visible";this.svg.style.whiteSpace="pre";
    this.svg.style.fontKerning="none";this.svg.style.fontVariantLigatures="none";
  }
  async update(scene:Scene,view:View):Promise<void>{
    const revision=++this.revision,r=this.renderer,s=r.sync,c=scene.requireComponent(this.id,"TextRenderer");
    if(!scene.active.get(this.id)||!c.enabled||!c.color.a||!r.resources.fonts.isReady(c.asset)){s.hidden(this.element,true);return;}
    const font=await r.resources.fonts.load(scene,c.asset);if(this.disposed||revision!==this.revision)return;
    const key=JSON.stringify([c.asset,c.text,c.fontSize,c.letterSpacing,c.lineHeight,c.alignment]);
    if(key!==this.key){this.layout=textLayout(c,font);this.key=key;}
    const layout=this.layout!,b=layout.bounds,u=view.pixelsPerUnit;
    const clip=r.depth.clipPlane(scene,this.id,view,b,0,{x:0,y:0},u);
    s.hidden(this.element,!clip.visible||!layout.visible);
    s.style(this.element,{transform:scene.cssMatrix(this.id,view,{x:0,y:0,z:0},u),clipPath:clip.css});
    r.setDepth(this.element,r.viewDepth(scene,this.id,{x:(b.left+b.right)/2,y:(b.bottom+b.top)/2,z:0}),c.sortingOrder);
    s.style(this.svg,{position:"absolute",left:`${b.left*u}px`,top:`${-b.top*u}px`,width:`${Math.max(.001,(b.right-b.left)*u)}px`,height:`${Math.max(.001,(b.top-b.bottom)*u)}px`,fontFamily:`"${font.family}"`,fontSize:`${c.fontSize*u}px`,letterSpacing:`${c.letterSpacing*u}px`,opacity:c.color.a});
    s.attribute(this.svg,"viewBox",`${b.left*u} ${-b.top*u} ${Math.max(.001,(b.right-b.left)*u)} ${Math.max(.001,(b.top-b.bottom)*u)}`);
    s.attribute(this.svg,"fill",`rgb(${c.color.r*255} ${c.color.g*255} ${c.color.b*255})`);
    while(this.lines.length<layout.lines.length){const line=document.createElementNS(NS,"text");line.setAttribute("xml:space","preserve");this.lines.push(line);this.svg.append(line);}
    for(const [i,line]of this.lines.entries()){
      const value=layout.lines[i];s.style(line,{display:value?"":"none"});if(!value)continue;
      if(line.textContent!==value.text)line.textContent=value.text;
      s.attrs(line,{x:value.left*u,y:(value.top+scene.fontAsset(c.asset).ascent*c.fontSize)*u});
    }
    s.attribute(this.element,"data-text",c.text);
  }
  dispose():void{this.disposed=true;this.revision++;this.renderer.removeSurface(this.element);}
}
