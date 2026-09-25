import {GridTransitionCell,RadialGridTransitionCell,gridTransitionFront,pinwheelCovered,pinwheelProfile,dissolveThreshold} from "./geometry.js";
import type {Bounds,GridTransitionSettings,RadialGridTransitionSettings,Transition,Vec2} from "./types.js";

/** One union path; fully revealed tiles share a single continuous polygon. */
export class DOMTransitionPath {
  private readonly cell=new GridTransitionCell();
  private readonly radialCell=new RadialGridTransitionCell();
  transition(bounds:Bounds,frameBounds:Bounds,c:Transition,project:(x:number,y:number)=>Vec2):string {
    if(c.kind==="fade")return "";
    if(c.kind==="grid")return this.build(bounds,frameBounds,c.grid,c.progress,project);
    if(c.kind==="radialGrid")return this.radial(bounds,c.radialGrid,c.progress,project);
    if(c.kind==="stripes"){
      const axis=c.stripes.axis,period=c.stripes.period,phase=c.stripes.phase,lo=axis==="x"?bounds.left:bounds.bottom,hi=axis==="x"?bounds.right:bounds.top,commands:string[]=[];
      for(let i=Math.floor((lo-phase)/period);i<Math.ceil((hi-phase)/period);i++){
        const start=phase+i*period,end=start+period*c.progress;
        const b=axis==="x"?{...bounds,left:Math.max(lo,start),right:Math.min(hi,end)}:{...bounds,bottom:Math.max(lo,start),top:Math.min(hi,end)};
        if(b.left>=b.right||b.bottom>=b.top)continue;
        [[b.left,b.bottom],[b.right,b.bottom],[b.right,b.top],[b.left,b.top]].forEach(([x,y],i)=>{const p=project(x,y);commands.push(`${i?"L":"M"}${p.x} ${p.y}`);});commands.push("Z");
      }return commands.join("");
    }
    const settings=c.kind==="pinwheel"?c.pinwheel:c.dissolve,{cellSize:s,origin:o}=settings;
    const sweep=c.kind==="dissolve"&&(c.dissolve.direction.x||c.dissolve.direction.y)?gridTransitionFront(frameBounds,{...c.dissolve,direction:c.dissolve.direction},c.progress):null;
    const covered=c.kind==="pinwheel"?((profile)=>((x:number,y:number)=>pinwheelCovered(x,y,profile)))(pinwheelProfile(c.pinwheel,c.progress)):(x:number,y:number)=>sweep?((o.x+(x+.5)*s.x)*sweep.direction.x+(o.y+(y+.5)*s.y)*sweep.direction.y+dissolveThreshold(x,y,c.dissolve.seed)*c.dissolve.feather<sweep.front):dissolveThreshold(x,y,c.dissolve.seed)<c.progress;
    const left=Math.floor((bounds.left-o.x)/s.x),right=Math.ceil((bounds.right-o.x)/s.x),bottom=Math.floor((bounds.bottom-o.y)/s.y),top=Math.ceil((bounds.top-o.y)/s.y),commands:string[]=[];
    // All row runs belong to one nonzero-filled path. Shared edges cancel in
    // the same fill operation, so partial opacity never creates tile seams.
    const point=(x:number,y:number,first:boolean)=>{const p=project(o.x+x*s.x,o.y+y*s.y);commands.push(`${first?"M":"L"}${Number(p.x.toFixed(10))} ${Number(p.y.toFixed(10))}`);};
    for(let y=bottom;y<top;y++){
      let run:number|undefined;
      for(let x=left;x<=right;x++){
        const on=x<right&&covered(x,y);
        if(on&&run===undefined)run=x;
        if(!on&&run!==undefined){point(run,y,true);point(x,y,false);point(x,y+1,false);point(run,y+1,false);commands.push("Z");run=undefined;}
      }
    }
    return commands.join("");
  }
  private radial(bounds:Bounds,g:RadialGridTransitionSettings,progress:number,project:(x:number,y:number)=>Vec2):string {
    const s=g.cellSize,o=g.origin,hx=s.x/2,hy=s.y/2,cell=this.radialCell,commands:string[]=[];
    const left=Math.floor((bounds.left-o.x)/s.x),right=Math.ceil((bounds.right-o.x)/s.x),bottom=Math.floor((bounds.bottom-o.y)/s.y),top=Math.ceil((bounds.top-o.y)/s.y);
    const point=(x:number,y:number,first:boolean)=>{const p=project(x,y);commands.push(`${first?"M":"L"}${Number(p.x.toFixed(10))} ${Number(p.y.toFixed(10))}`);};
    for(let y=bottom;y<top;y++){
      let run:number|undefined;
      for(let x=left;x<=right;x++){
        const cx=o.x+(x+.5)*s.x,cy=o.y+(y+.5)*s.y;
        if(x<right)cell.update(hx,hy,cx-g.center.x,cy-g.center.y,progress-g.inset,g.curvature);
        const full=x<right&&cell.full;
        if(full&&run===undefined)run=x;
        if(!full&&run!==undefined){
          point(o.x+run*s.x,o.y+y*s.y,true);point(o.x+x*s.x,o.y+y*s.y,false);point(o.x+x*s.x,o.y+(y+1)*s.y,false);point(o.x+run*s.x,o.y+(y+1)*s.y,false);commands.push("Z");run=undefined;
        }
        if(x<right&&!full&&cell.count>=3){for(let i=0;i<cell.count;i++)point(cx+cell.vertices[i*2],cy+cell.vertices[i*2+1],i===0);commands.push("Z");}
      }
    }
    return commands.join("");
  }
  build(bounds:Bounds,frameBounds:Bounds,grid:GridTransitionSettings,progress:number,project:(x:number,y:number)=>Vec2):string {
    const {direction,front}=gridTransitionFront(frameBounds,grid,progress),s=grid.cellSize,o=grid.origin;
    const left=Math.floor((bounds.left-o.x)/s.x),right=Math.ceil((bounds.right-o.x)/s.x),bottom=Math.floor((bounds.bottom-o.y)/s.y),top=Math.ceil((bounds.top-o.y)/s.y);
    const commands:string[]=[],halfX=s.x/2,halfY=s.y/2,gx=direction.x/grid.feather,gy=direction.y/grid.feather;
    const append=(cx:number,cy:number)=>{
      if(this.cell.count<3)return;
      for(let i=0;i<this.cell.count;i++){
        const p=project(cx+this.cell.vertices[i*2],cy+this.cell.vertices[i*2+1]);
        commands.push(`${i?"L":"M"}${Number(p.x.toFixed(10))} ${Number(p.y.toFixed(10))}`);
      }
      commands.push("Z");
    };
    this.cell.completed(bounds,direction,front-grid.feather);append(0,0);
    const variation=Math.abs(gx)*halfX+Math.abs(gy)*halfY;
    for(let y=bottom;y<top;y++)for(let x=left;x<right;x++){
      const cx=o.x+(x+.5)*s.x,cy=o.y+(y+.5)*s.y,q=(front-cx*direction.x-cy*direction.y)/grid.feather;
      if(q+variation<=0||q-variation>=1)continue;
      this.cell.update(halfX,halfY,q,gx,gy);append(cx,cy);
    }
    return commands.join("");
  }
}
