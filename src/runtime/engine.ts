import { Scene } from "./scene.js";
import { Resources } from "./resources.js";

import { Frame, Time, frameRate, type FrameNumber, type FrameTime, type FrameRate } from "./animation/time.js";
import { PerformanceClock, type AnimationClock, type ClockEvent } from "./animation/clock.js";
import { AudioPlayer } from "./audio-player.js";
import { PlayerControls } from "./player-controls.js";
import { DOMSync } from "./dom-sync.js";
import type { Renderer, View, Transform, EntityInput, Entity, ComponentMap, ComponentType, DeepPartial, SceneData } from "./types.js";

export class Engine {
  readonly viewport:HTMLElement;readonly renderer:Renderer;scene!:Scene;resources!:Resources;view!:View;
  ready=false;revision=0;pending:Promise<void>=Promise.resolve();listeners=new Set<(error:unknown)=>void>();disposed=false;time=0;loading=false;
  private loadTicket=0;private updateTicket=0;private animationFrame:number|null=null;private animationKey="";
  private readonly stateListeners=new Set<()=>void>();
  private transport?:AnimationClock;private unsubscribeClock?:()=>void;private readingClock=false;
  readonly audioPlayers=new Map<string,AudioPlayer>();
  private controlsInstance?:PlayerControls;private readonly controlsEnabled:boolean;private controlsOwner?:string;private controlsDelay=3000;
  private readonly viewportSync=new DOMSync();private viewKey="";
  private availableWidth=document.documentElement.clientWidth;private availableHeight=window.innerHeight;
  readonly onResize:()=>void;readonly onKey:(event:KeyboardEvent)=>void;readonly observer:ResizeObserver;generationMs=0;
  constructor({viewport,renderer,controls=true}:{viewport:HTMLElement;renderer:Renderer;controls?:boolean}){
    this.viewport=viewport;this.renderer=renderer;this.controlsEnabled=controls;
    this.onResize=()=>{this.availableWidth=document.documentElement.clientWidth;this.availableHeight=window.innerHeight;if(this.scene&&!this.loading)this.update();};
    this.onKey=e=>{if(!this.scene||e.code!==this.scene.data.presentation.toggleKey||e.repeat||e.altKey||e.ctrlKey||e.metaKey||(e.target instanceof HTMLElement&&(e.target.isContentEditable||/TEXTAREA|SELECT/.test(e.target.tagName)||e.target instanceof HTMLInputElement&&e.target.type!=="range")))return;e.preventDefault();this.setReferenceAspect(!this.scene.data.presentation.referenceAspect);};
    window.addEventListener("resize",this.onResize);window.addEventListener("keydown",this.onKey);
    this.observer=new ResizeObserver(this.onResize);this.observer.observe(document.documentElement);
  }
  async loadScene(input:unknown,{baseURL}:{baseURL?:string}={}){
    if(this.disposed)throw new Error("This engine has been disposed.");
    const ticket=this.loadTicket=(this.loadTicket||0)+1;
    let data=input;
    if(typeof input==="string"){
      const url=new URL(input,document.baseURI);
      const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error(`Could not load scene (${response.status}): ${url}`);
      data=await response.json();baseURL=response.url||url.href;
    }
    const scene=new Scene(data,baseURL||this.scene?.baseURL||document.baseURI);
    if(ticket!==this.loadTicket||this.disposed)return;
    this.releaseControls();this.releaseClock();this.time=0;this.revision++;this.ready=false;this.loading=true;this.renderer.disposeScene();this.resources?.dispose();this.resources=new Resources();this.scene=scene;
    const current=this.revision;
    try{
      for(const node of scene.authoredNodes.values()){
        const c=scene.component(node.id,"AudioPlayer");if(c?.enabled&&scene.active.get(node.id))this.audioPlayers.set(node.id,new AudioPlayer(node.id,scene.source(c.asset),c,this.viewport));
      }
      const reference=scene.animationPlayer?.clock;
      if(reference){const audio=this.audioPlayers.get(reference.entity);if(!audio)throw new Error(`Animation clock must be an active AudioPlayer: ${reference.entity}`);this.transport=audio;}
      else {const sequence=scene.sequence,rate=sequence?.tickResolution||frameRate(1),duration=sequence?Time.fromFrame(Frame.subtract(sequence.master.end,sequence.master.start)):Time.fromSeconds(scene.data.timeline.duration,rate);this.transport=new PerformanceClock(duration,rate,scene.data.timeline.loop);}
      this.unsubscribeClock=this.transport.subscribe(event=>this.clockChanged(event));
      await Promise.all([this.renderer.createScene(scene,this.resources),...this.audioPlayers.values()].map(value=>value instanceof AudioPlayer?value.ready:value));if(current!==this.revision)return;
      await this.update();if(current!==this.revision)return;this.loading=false;this.ready=true;
      this.syncControls();
      this.audioPlayer?.activateMediaSession();
      if(scene.data.timeline.autoplay)void this.play().catch(error=>{if(current===this.revision&&!(error instanceof DOMException&&error.name==="NotAllowedError"))this.reportError(error);});
      this.notifyState();return this;
    }catch(error){if(current!==this.revision)return;this.loading=false;this.ready=false;this.releaseControls();this.releaseClock();throw error;}
  }
  calculateView(){
    const c=this.scene.requireComponent(this.scene.cameraNode.id,"Camera"),availableWidth=this.availableWidth,availableHeight=this.availableHeight,dpr=window.devicePixelRatio||1;
    const key=JSON.stringify([availableWidth,availableHeight,dpr,this.scene.data.presentation.referenceAspect,c.referenceAspect,c.referenceVerticalSize,c.projection,c.verticalFovDegrees,c.principalPoint,c.aspectPolicy,c.clearColor]);
    if(this.viewKey===key)return;this.viewKey=key;
    let width=availableWidth,height=availableHeight;
    if(this.scene.data.presentation.referenceAspect){width=Math.min(width,height*c.referenceAspect);height=width/c.referenceAspect;}
    this.viewportSync.style(this.viewport,{width:`${width}px`,height:`${height}px`,left:`${(availableWidth-width)/2}px`,top:`${(availableHeight-height)/2}px`});
    this.viewportSync.attribute(this.viewport,"data-aspect",this.scene.data.presentation.referenceAspect?"reference":"adaptive");
    const color=c.clearColor;this.viewportSync.style(this.viewport,{backgroundColor:`rgb(${color.r*255} ${color.g*255} ${color.b*255} / ${color.a})`});
    const aspect=width/height,referenceWidth=c.referenceVerticalSize*c.referenceAspect;
    const worldHeight=(c.aspectPolicy==="fillReference"?Math.min:Math.max)(c.referenceVerticalSize,referenceWidth/aspect);
    this.view={width,height,aspect,worldWidth:worldHeight*aspect,worldHeight,pixelsPerUnit:height/worldHeight,dpr};
  }
  update(notify=true){
    const updateTicket=this.updateTicket=(this.updateTicket||0)+1;
    this.scene.updateWorld();this.calculateView();this.animationKey=this.scene.animationSignature();
    if(notify)this.notifyState();
    this.pending=Promise.resolve(this.renderer.update(this.scene,this.view));
    const revision=this.revision;this.pending.catch(error=>{if(revision===this.revision&&updateTicket===this.updateTicket)for(const fn of this.listeners)fn(error);});return this.pending;
  }
  onError(fn:(error:unknown)=>void){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  /** Transport, explicit seeks, scene edits and view changes; not animation ticks. */
  onStateChange(fn:()=>void):()=>void {this.stateListeners.add(fn);return()=>{this.stateListeners.delete(fn);};}
  private notifyState():void {for(const listener of this.stateListeners)listener();}
  get clock():AnimationClock|undefined{return this.transport;}
  get playerControls():PlayerControls|undefined{return this.controlsInstance;}
  get audioPlayer():AudioPlayer|undefined{return this.transport instanceof AudioPlayer?this.transport:undefined;}
  get playing():boolean{return this.transport?.playing??false;}
  get duration():number{return this.transport?.duration??this.scene?.data.timeline.duration??0;}
  get playbackRate():number {return this.transport?.playbackRate??1;}
  get loop():boolean{return this.transport?.loop??false;}
  setLoop(enabled:boolean):void {this.scene.data.timeline.loop=enabled;this.transport?.setLoop(enabled);this.notifyState();}
  whenIdle(){return this.pending;}
  seek(time:number):Promise<void>{
    if(!Number.isFinite(time)||time<0)throw new Error("Timeline time must be finite and nonnegative.");
    const rate=this.scene.sequence?.tickResolution||frameRate(1);return this.seekFrame(Time.fromSeconds(time,rate),rate);
  }
  async seekFrame(frame:FrameNumber|FrameTime,rate:FrameRate=this.scene.sequence?.displayRate||frameRate(this.scene.data.timeline.frameRate)):Promise<void>{
    this.scene.animationEnabled=true;const current=this.revision;
    await this.transport?.seek(typeof frame==="number"?Time.fromFrame(frame):frame,rate);
    if(current!==this.revision||this.disposed)return;
    this.readClock();this.notifyState();await this.pending;
  }
  setPlaybackRate(numerator:number,denominator=1):void {this.transport?.setPlaybackRate(numerator,denominator);this.notifyState();}
  play():Promise<void> {
    if(this.disposed||!this.transport)return Promise.resolve();this.scene.animationEnabled=true;return this.transport.play();
  }
  pause():void {this.transport?.pause();this.cancelTick();if(this.audioPlayer)this.readClock();this.notifyState();}
  async stop():Promise<void>{this.pause();await this.seek(0);this.scene.animationEnabled=false;await this.update();}
  private reportError(error:unknown):void {for(const fn of this.listeners)fn(error);}
  private readClock(now?:number):void {
    if(!this.transport||this.readingClock||this.loading||this.disposed)return;
    this.readingClock=true;
    try{const wasPlaying=this.playing,rate=this.scene.sequence?.tickResolution||frameRate(this.scene.data.timeline.frameRate);this.scene.setFrameTime(this.transport.sample(rate,now),rate);this.time=this.scene.time;
      if(this.animationKey!==this.scene.animationSignature())this.update(false);
      if(wasPlaying!==this.playing)this.notifyState();
    }finally{this.readingClock=false;}
  }
  private clockChanged(event:ClockEvent):void {
    if(this.disposed||this.loading)return;
    if(event.type==="error"){this.reportError(event.error);return;}
    // RAF samples moving time. Native timeupdate is not a UI state change.
    if(event.type==="time"&&!event.discontinuity&&this.playing)return;
    if(event.type==="time"&&event.discontinuity||this.playing)this.scene.animationEnabled=true;
    if(event.type==="time"||(this.transport?.kind==="audio"&&event.type!=="volume"))this.readClock();this.notifyState();
    if(this.playing)this.scheduleTick();else this.cancelTick();
  }
  private scheduleTick():void {
    if(this.animationFrame!==null||!this.playing||this.disposed)return;
    this.animationFrame=requestAnimationFrame(now=>{this.animationFrame=null;if(!this.playing||this.disposed)return;try{this.readClock(now);}catch(error){this.pause();this.reportError(error);return;}this.scheduleTick();});
  }
  private cancelTick():void {if(this.animationFrame!==null){cancelAnimationFrame(this.animationFrame);this.animationFrame=null;}}
  private releaseClock():void {this.unsubscribeClock?.();this.unsubscribeClock=undefined;this.cancelTick();this.transport?.dispose();for(const audio of this.audioPlayers.values())audio.dispose();this.audioPlayers.clear();this.transport=undefined;}
  private releaseControls():void {this.controlsInstance?.dispose();this.controlsInstance=undefined;this.controlsOwner=undefined;}
  private syncControls():void {
    if(!this.controlsEnabled)return;
    let declared=false,selected:{entity:string;component:ComponentMap["PlayerControls"]}|undefined;
    for(const node of this.scene.authoredNodes.values()){
      const component=this.scene.component(node.id,"PlayerControls");if(!component)continue;declared=true;
      if(!component.enabled||!this.scene.active.get(node.id))continue;
      if(selected)throw new Error("Only one active PlayerControls component can own the screen UI.");selected={entity:node.id,component};
    }
    const reference=selected?.component.player;
    if(reference&&(!this.scene.active.get(reference.entity)||this.scene.component(reference.entity,"AnimationPlayer")!==this.scene.animationPlayer))throw new Error("PlayerControls must reference the active AnimationPlayer.");
    const mount=!!selected||!declared&&this.duration>0,delay=selected?.component.hideDelayMs??3000;
    if(mount&&this.controlsInstance&&this.controlsOwner===selected?.entity&&this.controlsDelay===delay)return;
    this.releaseControls();
    // Legacy scene studies retain automatic controls until they declare a component.
    if(mount){
      this.controlsOwner=selected?.entity;this.controlsDelay=delay;
      this.controlsInstance=new PlayerControls(this,selected?{hideDelayMs:selected.component.hideDelayMs}:{});
      if(selected){this.controlsInstance.element.dataset.entity=selected.entity;this.controlsInstance.element.dataset.component="PlayerControls";}
    }
  }
  find(id:string){return this.scene.find(id);}
  setTransform(id:string,values:DeepPartial<Transform>){this.scene.setTransform(id,values);return this.update();}
  setComponent<K extends ComponentType>(id:string,type:K,values:DeepPartial<ComponentMap[K]>){this.scene.setComponent(id,type,values);if(type==="AudioPlayer"||type==="AnimationPlayer")return this.loadScene(this.scene.export(),{baseURL:this.scene.baseURL}).then(()=>{});const pending=this.update();if(type==="PlayerControls")this.syncControls();return pending;}
  setActive(id:string,active:boolean){const node=this.find(id),old=node.active;node.active=Boolean(active);try{const pending=this.update();this.syncControls();return pending;}catch(e){node.active=old;this.scene.updateWorld();throw e;}}
  setReferenceAspect(value:boolean){this.scene.data.presentation.referenceAspect=Boolean(value);return this.update();}
  setCamera(id:string){if(!this.scene.component(id,"Camera"))throw new Error(`Entity is not a Camera: ${id}`);this.scene.data.presentation.activeCamera=id;return this.update();}
  exportScene(){return this.scene.export();}
  async editScene(edit:(data:SceneData)=>void){const data=this.exportScene(),original=this.scene.original;edit(data);await this.loadScene(data,{baseURL:this.scene.baseURL});this.scene.original=original;return this;}
  addEntity(parentId:string,entity:EntityInput){this.find(parentId);return this.editScene(data=>{const visit=(n:Entity)=>{if(n.id===parentId)n.children.push(structuredClone(entity) as Entity);else n.children.forEach(visit);};visit(data.root);});}
  removeEntity(id:string){if(id===this.scene.data.root.id)throw new Error("Cannot remove the scene root.");this.find(id);return this.editScene(data=>{const visit=(n:Entity)=>{n.children=n.children.filter(c=>c.id!==id);n.children.forEach(visit);};visit(data.root);});}
  addComponent(id:string,component:EntityInput["components"] extends (infer C)[]|undefined?C:never){this.find(id);return this.editScene(data=>{const visit=(n:Entity)=>{if(n.id===id)n.components.push(structuredClone(component) as ComponentMap[ComponentType]);n.children.forEach(visit);};visit(data.root);});}
  removeComponent(id:string,type:ComponentType){this.find(id);return this.editScene(data=>{const visit=(n:Entity)=>{if(n.id===id)n.components=n.components.filter(c=>c.type!==type);n.children.forEach(visit);};visit(data.root);});}
  reset(){return this.loadScene(this.scene.original,{baseURL:this.scene.baseURL});}
  dispose(){if(this.disposed)return;this.releaseControls();this.releaseClock();this.disposed=true;this.notifyState();this.stateListeners.clear();this.revision++;this.observer.disconnect();window.removeEventListener("resize",this.onResize);window.removeEventListener("keydown",this.onKey);this.renderer.dispose();this.resources?.dispose();}
}
