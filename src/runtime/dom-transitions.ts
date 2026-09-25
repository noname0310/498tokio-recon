import type {DOMRenderer} from "./dom.js";
import type {TransitionGroup} from "./transitions.js";
import type {View} from "./types.js";
import type {Scene} from "./scene.js";
import {Math3D as M} from "./math.js";
import {DOMTransitionPath} from "./dom-transition-path.js";
import {transitionGeometryKey} from "./geometry.js";
const NS="http://www.w3.org/2000/svg";
let serial=0;
interface MaskGroup {element:HTMLDivElement;clip:SVGClipPathElement;path:SVGPathElement;geometry:DOMTransitionPath;key:string}

export class DOMTransitions {
  private readonly groups=new Map<string,MaskGroup>();
  private readonly parents=new Map<string,HTMLDivElement>();
  constructor(private readonly renderer:DOMRenderer){}
  parent(id:string):HTMLDivElement|undefined{return this.parents.get(id);}
  update(groups:TransitionGroup[],surfaces:Iterable<HTMLDivElement>,view:View,scene:Scene):void {
    if(!groups.length&&!this.groups.size)return;
    const r=this.renderer,sync=r.sync,parents=this.parents;parents.clear();
    for(const group of groups){
      let record=this.groups.get(group.id);
      if(!record){
        const element=document.createElement("div"),clip=document.createElementNS(NS,"clipPath"),path=document.createElementNS(NS,"path");
        element.className="transition-layer";element.dataset.transition=group.id;
        clip.id=`transition-mask-${++serial}`;clip.setAttribute("clipPathUnits","userSpaceOnUse");path.setAttribute("clip-rule","nonzero");clip.append(path);r.defs.append(clip);r.world.append(element);
        record={element,clip,path,geometry:new DOMTransitionPath(),key:""};this.groups.set(group.id,record);
      }
      const {component:c,bounds,frameBounds}=group;
      sync.hidden(record.element,false);r.setDepth(record.element,group.depth);
      const fade=c.kind==="fade",masked=!fade&&c.enabled&&c.progress<1;
      sync.attribute(record.element,"data-composition",fade&&c.enabled?c.composition:null);
      sync.style(record.element,{opacity:fade&&c.enabled?c.progress:1,visibility:(fade&&c.enabled&&c.progress<=0)||masked&&(c.progress<=0||!bounds||!frameBounds)?"hidden":"visible",clipPath:masked?`url(#${record.clip.id})`:"none"});
      if(masked&&c.progress>0&&bounds&&frameBounds){
        const key=JSON.stringify([transitionGeometryKey(c),bounds,frameBounds,group.viewMatrix,view.width,view.height,view.pixelsPerUnit,scene.requireComponent(scene.cameraNode.id,"Camera")]);
        if(key!==record.key){
          record.key=key;
          sync.attribute(record.path,"d",record.geometry.transition(bounds,frameBounds,c,(x,y)=>{const p=scene.projectCameraPoint(M.point(group.viewMatrix,{x,y,z:0}));return {x:view.width/2+p.x*view.pixelsPerUnit,y:view.height/2-p.y*view.pixelsPerUnit};}));
        }
      }
      for(const id of group.members)parents.set(id,record.element);
    }
    // Move only when ownership changes. Objects, filters and images are retained.
    for(const surface of surfaces){
      if(surface.classList.contains("transition-layer"))continue;
      const parent=parents.get(surface.dataset.entity||"")||r.world;
      if(surface.parentElement!==parent)parent.append(surface);
    }
    const active=new Set(groups.map(g=>g.id));
    for(const [id,record] of this.groups)if(!active.has(id))sync.hidden(record.element,true);
  }
  dispose():void {for(const record of this.groups.values()){this.renderer.removeSurface(record.element);record.clip.remove();}this.groups.clear();this.parents.clear();}
}
