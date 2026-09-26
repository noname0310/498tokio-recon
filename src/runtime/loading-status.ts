export interface LoadingStage {name:string;completed:number;total:number;items:ReadonlyMap<number,string>}
export interface LoadingTask {():void;update(item:string):void}

/** Runtime tasks report progress without depending on scene components or DOM. */
export class LoadingProgress {
  private generation=0;private nextId=0;
  private finished=false;
  get isComplete():boolean{return this.finished;}
  private readonly stages=new Map<string,{name:string;completed:number;total:number;items:Map<number,string>}>();
  private readonly listeners=new Set<(stages:Iterable<LoadingStage>)=>void>();
  subscribe(listener:(stages:Iterable<LoadingStage>)=>void):()=>void {this.listeners.add(listener);listener(this.stages.values());return()=>this.listeners.delete(listener);}
  begin(name:string,item:string):LoadingTask {
    this.finished=false;
    let stage=this.stages.get(name);
    if(!stage){stage={name,completed:0,total:0,items:new Map()};this.stages.set(name,stage);}
    const id=this.nextId++,generation=this.generation;stage.total++;stage.items.set(id,item);this.emit();
    return Object.assign(
      ()=>{if(generation!==this.generation||!stage.items.delete(id))return;stage.completed++;this.emit();},
      {update:(item:string)=>{if(generation!==this.generation||!stage.items.has(id)||stage.items.get(id)===item)return;stage.items.set(id,item);this.emit();}}
    );
  }
  complete():void {if([...this.stages.values()].some(stage=>stage.items.size))throw new Error("Loading still has unfinished tasks.");this.finished=true;this.emit();}
  reset():void {this.generation++;this.finished=false;this.stages.clear();this.emit();}
  private emit():void {for(const listener of this.listeners)listener(this.stages.values());}
}

function logLine(stage:string,detail:string,count=""):HTMLDivElement {
  const row=document.createElement("div");row.className="loading-line";
  for(const [className,text] of [["loading-stage",stage],["loading-count",count],["loading-detail",detail]]){
    const span=document.createElement("span");span.className=className;span.textContent=text;row.append(span);
  }
  return row;
}

/** A single text overlay owned by the runtime, independent of scene cameras. */
export class LoadingStatus {
  readonly element=document.createElement("div");
  private readonly unsubscribe:()=>void;
  private hasPlayed=false;private active=false;private complete=false;private hasEntries=false;
  private started=performance.now();
  private sceneName?:string;
  private scrollFrame:number|null=null;
  private readonly context=document.createElement("div");
  constructor(progress:LoadingProgress){
    this.element.className="runtime-loading-status";this.element.hidden=true;
    this.element.setAttribute("role","status");this.element.setAttribute("aria-live","polite");document.body.append(this.element);
    const history=document.createElement("div"),current=document.createElement("div"),summary=document.createElement("div");this.context.className="loading-context";this.element.append(this.context,history,current,summary);summary.hidden=true;
    const pending=new Map<number,{stage:string;item:string}>(),activeRows=new Map<string,HTMLDivElement>();
    this.unsubscribe=progress.subscribe(stages=>{
      const snapshot=[...stages],active=snapshot.filter(stage=>stage.items.size>0);
      if(!snapshot.length&&!progress.isComplete){this.context.replaceChildren();history.replaceChildren();pending.clear();this.sceneName=undefined;this.hasPlayed=false;this.started=performance.now();}
      const ids=new Set(snapshot.flatMap(stage=>[...stage.items.keys()]));
      for(const [id,entry] of pending)if(!ids.has(id)){
        const verb=({Scene:"Loaded",Audio:"Loaded",Fonts:"Loaded",Images:"Loaded",Textures:"Generated",Shaders:"Compiled"} as Record<string,string>)[entry.stage]??"Finished";
        const row=logLine(verb,` ${entry.item}`);row.dataset.state="complete";history.append(row);pending.delete(id);
      }
      for(const stage of snapshot)for(const [id,item] of stage.items)pending.set(id,{stage:stage.name,item});
      for(const [name,row] of activeRows)if(!active.some(stage=>stage.name===name)){row.remove();activeRows.delete(name);}
      for(const stage of active){
        let row=activeRows.get(stage.name);
        const count=` ${stage.completed} / ${stage.total} — `,item=stage.items.values().next().value!;
        if(!row){row=logLine(stage.name,item,count);row.dataset.state="active";row.dataset.stage=stage.name;activeRows.set(stage.name,row);current.append(row);}
        if(row.children[1].textContent!==count)row.children[1].textContent=count;
        if(row.children[2].textContent!==item)row.children[2].textContent=item;
      }
      this.active=active.length>0;this.complete=progress.isComplete;this.hasEntries=this.context.childElementCount>0||snapshot.length>0||this.complete;
      if(this.complete&&summary.hidden){summary.replaceChildren(logLine("Finished",` Successfully prepared ${this.sceneName?`"${this.sceneName}"`:"scene"} in ${((performance.now()-this.started)/1000).toFixed(2)}s`));summary.dataset.state="finished";}
      summary.hidden=!this.complete;
      this.updateVisibility();
      // Native overflow scrolling keeps the latest work visible on small screens.
      if(this.scrollFrame===null)this.scrollFrame=requestAnimationFrame(()=>{this.scrollFrame=null;this.element.scrollTop=this.element.scrollHeight;});
    });
  }
  setContext(sceneName:string,entries:readonly (readonly [string,string])[]):void {
    this.sceneName=sceneName;
    this.context.replaceChildren(...entries.map(([label,value])=>logLine(label,` ${value}`)));
    this.hasEntries||=entries.length>0;this.updateVisibility();
  }
  playbackStarted():void {if(this.hasPlayed)return;this.hasPlayed=true;this.updateVisibility();}
  private updateVisibility():void {const hidden=!this.hasEntries||this.complete&&!this.active&&this.hasPlayed;if(this.element.hidden!==hidden)this.element.hidden=hidden;}
  dispose():void {this.unsubscribe();if(this.scrollFrame!==null)cancelAnimationFrame(this.scrollFrame);this.element.remove();}
}
