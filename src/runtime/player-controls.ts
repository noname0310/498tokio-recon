import type {Engine} from "./engine.js";
import {Frame,Time,frameRate,type FrameRate,type FrameNumber} from "./animation/time.js";

const paths={
  play:"M8 5v14l11-7z",pause:"M6 5h4v14H6zm8 0h4v14h-4z",
  previous:"M5 5h2v14H5zm14 0v14L8 12z",next:"M17 5h2v14h-2zM5 5l11 7-11 7z",
  volume:"M3 9v6h4l5 4V5L7 9zm12-1v8a5 5 0 000-8zm2-4v2a7 7 0 010 12v2a9 9 0 000-16z",
  muted:"M3 9v6h4l5 4V5L7 9zm12-1 3 3 3-3 1 1-3 3 3 3-1 1-3-3-3 3-1-1 3-3-3-3z",
  loop:"m17 2 5 5-5 5V8H7a3 3 0 00-3 3H2a5 5 0 015-5h10zM7 22l-5-5 5-5v4h10a3 3 0 003-3h2a5 5 0 01-5 5H7z",
  aspect:"M2 5h20v14H2zm2 2v10h16V7zm3 1h10v8H7z",
  fullscreen:"M3 3h7v2H5v5H3zm11 0h7v7h-2V5h-5zM3 14h2v5h5v2H3zm16 0h2v7h-7v-2h5z",
  exitFullscreen:"M8 3h2v7H3V8h5zm6 0h2v5h5v2h-7zM3 14h7v7H8v-5H3zm11 0h7v2h-5v5h-2z"
} as const;
type Icon=keyof typeof paths;
function text(element:HTMLElement,value:string):void {const node=element.firstChild;if(node instanceof Text){if(node.data!==value)node.data=value;}else element.append(document.createTextNode(value));}
function timeLabel(seconds:number):string {const value=Math.max(0,Math.floor(seconds)),s=String(value%60).padStart(2,"0"),m=Math.floor(value/60);return m>=60?`${Math.floor(m/60)}:${String(m%60).padStart(2,"0")}:${s}`:`${m}:${s}`;}
export interface PlayerControlsOptions {hideDelayMs?:number}

/** Native inputs and CSS own interaction/layout. State events update controls;
 * a 10 Hz timer updates only visible progress, never animation or hidden UI. */
export class PlayerControls {
  readonly element=document.createElement("div");
  private readonly events=new AbortController();private readonly unsubscribe:()=>void;
  private readonly toolbar=document.createElement("div");private readonly timeline=document.createElement("input");
  private readonly tooltip=document.createElement("output");private readonly feedback=document.createElement("output");
  private readonly menu=document.createElement("div");private readonly volume=document.createElement("input");
  private readonly speedSlider=document.createElement("input");private readonly speedValue=document.createElement("output");
  private readonly presets:HTMLButtonElement[]=[];private readonly icons=new Map<HTMLButtonElement,SVGPathElement>();
  private readonly playButton:HTMLButtonElement;private readonly muteButton:HTMLButtonElement;private readonly timeButton:HTMLButtonElement;
  private readonly loopButton:HTMLButtonElement;private readonly aspectButton:HTMLButtonElement;private readonly fullscreenButton:HTMLButtonElement;private readonly speedButton:HTMLButtonElement;
  private hideTimer=0;private feedbackTimer=0;private progressTimer=0;private disposed=false;private shown=true;private hovering=false;private keyboard=false;
  private scrubbing=false;private resumeAfterScrub=false;private scrubTicket=0;private seekPending=Promise.resolve();private frames=false;
  private lastPlaying:boolean|undefined;private lastRevision=-1;private lastPointerX=-1;private lastPointerY=-1;
  private displayRate:FrameRate=frameRate(30);private lastDuration=-1;private lastFrame=-1;private lastSpeed=NaN;private lastVolume=-1;
  private lastMuted:boolean|undefined;private lastAudio:boolean|undefined;private lastLoop:boolean|undefined;private lastAspect:boolean|undefined;private lastFullscreen:boolean|undefined;private lastBuffering:boolean|undefined;
  private readonly hideDelay:number;
  constructor(readonly engine:Engine,options:PlayerControlsOptions={}){
    this.hideDelay=options.hideDelayMs??3000;
    const root=this.element,signal=this.events.signal,screen=document.documentElement;
    root.className="player-controls";root.dataset.visible="true";root.setAttribute("role","group");root.setAttribute("aria-label","Playback controls");
    this.toolbar.className="player-toolbar";
    const progress=document.createElement("div");progress.className="player-progress";
    this.timeline.type="range";this.timeline.className="player-timeline";this.timeline.min="0";this.timeline.step="1";this.timeline.setAttribute("aria-label","Seek frame");
    this.tooltip.className="player-seek-tooltip";this.tooltip.hidden=true;progress.append(this.timeline,this.tooltip);
    const chrome=document.createElement("div");chrome.className="player-chrome";chrome.append(progress,this.toolbar);root.append(chrome);
    this.playButton=this.button("play","Play (K)",()=>this.toggle());this.playButton.dataset.action="play";
    this.button("previous","Previous frame (,)",()=>this.step(-1)).classList.add("player-frame-step");
    this.button("next","Next frame (.)",()=>this.step(1)).classList.add("player-frame-step");
    this.muteButton=this.button("volume","Mute (M)",()=>this.toggleMute());this.muteButton.dataset.action="mute";
    this.volume.type="range";this.volume.className="player-volume";this.volume.min="0";this.volume.max="1";this.volume.step=".01";this.volume.setAttribute("aria-label","Volume");
    this.toolbar.append(this.volume);
    this.timeButton=this.textButton("","Show frame numbers",()=>{this.frames=!this.frames;const label=this.frames?"Show time":"Show frame numbers";this.timeButton.title=label;this.timeButton.setAttribute("aria-label",label);this.updateProgress();});this.timeButton.className="player-time";
    const spacer=document.createElement("span");spacer.className="player-spacer";this.toolbar.append(spacer);
    this.loopButton=this.button("loop","Loop",()=>engine.setLoop(!engine.loop));this.loopButton.classList.add("player-loop");
    this.speedButton=this.textButton("1×","Playback speed",()=>this.setMenu(this.menu.hidden));this.speedButton.dataset.action="speed";this.speedButton.setAttribute("aria-haspopup","dialog");this.speedButton.setAttribute("aria-expanded","false");
    this.aspectButton=this.button("aspect","Reference aspect ratio (A)",()=>{void engine.setReferenceAspect(!engine.scene.data.presentation.referenceAspect);});
    this.fullscreenButton=this.button("fullscreen","Fullscreen (F)",()=>{void this.fullscreen();});
    this.menu.className="player-speed-menu";this.menu.hidden=true;this.menu.setAttribute("role","dialog");this.menu.setAttribute("aria-label","Playback speed");
    const speedControl=document.createElement("label");speedControl.className="player-speed-control";
    const speedHeading=document.createElement("span");speedHeading.className="player-speed-heading";const speedLabel=document.createElement("span");speedLabel.textContent="Playback speed";speedHeading.append(speedLabel,this.speedValue);
    this.speedSlider.type="range";this.speedSlider.className="player-speed-slider";this.speedSlider.min=".25";this.speedSlider.max="2";this.speedSlider.step=".01";this.speedSlider.setAttribute("aria-label","Playback speed");
    this.speedSlider.addEventListener("input",()=>this.setSpeed(Number(this.speedSlider.value)),{signal});speedControl.append(speedHeading,this.speedSlider);this.menu.append(speedControl);
    const presetList=document.createElement("div");presetList.className="player-speed-presets";presetList.setAttribute("role","menu");presetList.setAttribute("aria-label","Speed presets");this.menu.append(presetList);
    for(const speed of [.25,.5,.75,1,1.25,1.5,2]){
      const button=document.createElement("button");button.type="button";button.textContent=speed===1?"Normal":`${speed}×`;button.dataset.speed=String(speed);button.setAttribute("role","menuitemradio");
      button.addEventListener("click",()=>{if(this.setSpeed(speed)){this.setMenu(false);this.speedButton.focus();}},{signal});this.presets.push(button);presetList.append(button);
    }
    root.append(this.menu);this.feedback.className="player-feedback";this.feedback.hidden=true;this.feedback.setAttribute("role","status");document.body.append(root,this.feedback);
    engine.viewport.setAttribute("aria-label","Animation player");if(!engine.viewport.hasAttribute("tabindex"))engine.viewport.tabIndex=0;
    screen.addEventListener("pointermove",event=>{
      if(event.clientX===this.lastPointerX&&event.clientY===this.lastPointerY)return;
      this.lastPointerX=event.clientX;this.lastPointerY=event.clientY;this.keyboard=false;this.hovering=this.shown&&root.contains(event.target as Node);this.show();
    },{signal});
    screen.addEventListener("pointerdown",()=>{this.keyboard=false;this.show();},{signal});
    screen.addEventListener("pointerleave",()=>{this.hovering=false;this.armHide();},{signal});
    root.addEventListener("pointerenter",()=>{if(this.shown){this.hovering=true;this.armHide();}},{signal});
    root.addEventListener("pointerleave",()=>{this.hovering=false;this.armHide();},{signal});
    root.addEventListener("focusin",()=>{if(this.keyboard)this.show();},{signal});
    root.addEventListener("focusout",()=>{queueMicrotask(()=>this.armHide());},{signal});
    this.timeline.addEventListener("pointerdown",()=>{this.scrubbing=true;this.resumeAfterScrub=engine.playing;this.scrubTicket++;engine.pause();this.show();},{signal});
    this.timeline.addEventListener("input",()=>{const frame=Number(this.timeline.value);if(!this.scrubbing)engine.pause();this.seekPending=engine.seekFrame(Frame.from(frame)).catch(error=>this.failure(error));this.updateTime(frame);},{signal});
    window.addEventListener("pointerup",()=>{void this.finishScrub();},{signal});window.addEventListener("pointercancel",()=>{void this.finishScrub();},{signal});
    this.timeline.addEventListener("pointermove",event=>{const bounds=this.timeline.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width));this.tooltip.hidden=false;this.tooltip.textContent=timeLabel(fraction*engine.duration);this.tooltip.style.left=`${Math.max(35,Math.min(bounds.width-35,fraction*bounds.width))}px`;},{signal});
    this.timeline.addEventListener("pointerleave",()=>{this.tooltip.hidden=true;},{signal});
    this.volume.addEventListener("input",()=>{const audio=engine.audioPlayer;if(audio){audio.setVolume(Number(this.volume.value));audio.setMuted(false);}},{signal});
    document.addEventListener("keydown",event=>this.keydown(event),{signal});
    document.addEventListener("fullscreenchange",()=>{this.refreshState();this.show();},{signal});
    document.addEventListener("visibilitychange",()=>{if(document.hidden)clearTimeout(this.hideTimer);else{this.updateProgress();this.show();}this.syncProgressTimer();},{signal});
    document.addEventListener("pointerdown",event=>{if(!root.contains(event.target as Node))this.setMenu(false);},{signal});
    window.addEventListener("blur",()=>{if(this.scrubbing){this.resumeAfterScrub=false;void this.finishScrub();}},{signal});
    this.unsubscribe=engine.onStateChange(()=>this.refreshState());this.refreshState();this.show();
  }
  private textButton(text:string,label:string,action:()=>void):HTMLButtonElement {
    const button=document.createElement("button");button.type="button";button.append(document.createTextNode(text));button.title=label;button.setAttribute("aria-label",label);
    button.addEventListener("click",action,{signal:this.events.signal});this.toolbar.append(button);return button;
  }
  private button(name:Icon,label:string,action:()=>void):HTMLButtonElement {
    const button=this.textButton("",label,action),svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),path=document.createElementNS(svg.namespaceURI,"path") as SVGPathElement;
    svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");path.setAttribute("d",paths[name]);svg.append(path);button.replaceChildren(svg);this.icons.set(button,path);return button;
  }
  private setIcon(button:HTMLButtonElement,name:Icon):void {const path=this.icons.get(button)!;if(path.getAttribute("d")!==paths[name])path.setAttribute("d",paths[name]);}
  private get rate():FrameRate{return this.displayRate;}
  private get frame():FrameNumber {
    const scene=this.engine.scene;
    // The label and step buttons use the frame actually evaluated by the scene.
    return Time.floor(Time.convert(scene.timelineTime,frameRate(1),this.rate));
  }
  private refreshState():void {
    if(this.disposed)return;if(this.engine.disposed){this.dispose();return;}
    const engine=this.engine;if(!engine.scene)return;
    let changed=false;
    if(this.lastRevision!==engine.revision){this.lastRevision=engine.revision;this.displayRate=engine.scene.sequence?.displayRate||frameRate(engine.scene.data.timeline.frameRate);this.lastDuration=-1;this.lastFrame=-1;this.scrubTicket++;this.scrubbing=false;this.resumeAfterScrub=false;this.setMenu(false);}
    if(this.lastDuration!==engine.duration){this.lastDuration=engine.duration;this.element.hidden=engine.duration<=0;const end=Time.ceil(Time.fromSeconds(engine.duration,this.rate));this.timeline.max=String(Frame.compare(end,Frame.zero)>0?Frame.previous(end):Frame.zero);this.lastFrame=-1;changed=true;}
    if(this.lastPlaying!==engine.playing){this.lastPlaying=engine.playing;this.setIcon(this.playButton,engine.playing?"pause":"play");this.playButton.title=engine.playing?"Pause (K)":"Play (K)";this.playButton.setAttribute("aria-label",this.playButton.title);changed=true;if(engine.playing)this.armHide();else this.show();}
    if(this.lastSpeed!==engine.playbackRate){
      this.lastSpeed=engine.playbackRate;const label=`${Number(engine.playbackRate.toFixed(2))}×`;text(this.speedButton,label);text(this.speedValue,label);this.speedSlider.value=String(engine.playbackRate);this.speedSlider.setAttribute("aria-valuetext",label);
      for(const button of this.presets)button.setAttribute("aria-checked",String(Number(button.dataset.speed)===engine.playbackRate));
    }
    if(this.lastLoop!==engine.loop){this.lastLoop=engine.loop;this.loopButton.setAttribute("aria-pressed",String(engine.loop));}
    const aspect=engine.scene.data.presentation.referenceAspect;if(this.lastAspect!==aspect){this.lastAspect=aspect;this.aspectButton.setAttribute("aria-pressed",String(aspect));}
    const fullscreen=!!document.fullscreenElement;if(this.lastFullscreen!==fullscreen){this.lastFullscreen=fullscreen;this.setIcon(this.fullscreenButton,fullscreen?"exitFullscreen":"fullscreen");}
    const audio=engine.audioPlayer;if(this.lastAudio!==!!audio){this.lastAudio=!!audio;this.muteButton.hidden=this.volume.hidden=!audio;}
    if(audio&&(this.lastVolume!==audio.volume||this.lastMuted!==audio.muted)){this.lastVolume=audio.volume;this.lastMuted=audio.muted;this.volume.value=String(audio.muted?0:audio.volume);this.setIcon(this.muteButton,audio.muted||!audio.volume?"muted":"volume");this.muteButton.setAttribute("aria-label",audio.muted?"Unmute (M)":"Mute (M)");}
    const buffering=engine.clock?.buffering??false;if(this.lastBuffering!==buffering){this.lastBuffering=buffering;this.element.dataset.buffering=String(buffering);}
    if(changed||!engine.playing)this.updateProgress();this.syncProgressTimer();
  }
  private updateTime(frame:number):void {
    if(this.lastFrame!==frame){this.lastFrame=frame;const fraction=frame/Math.max(1,Number(this.timeline.max));this.timeline.style.setProperty("--progress",`${fraction*100}%`);this.timeline.setAttribute("aria-valuetext",`${timeLabel(frame*this.rate.denominator/this.rate.numerator)}, frame ${frame}`);}
    text(this.timeButton,this.frames?`${frame} / ${this.timeline.max}`:`${timeLabel(this.scrubbing?frame*this.rate.denominator/this.rate.numerator:this.engine.time)} / ${timeLabel(this.engine.duration)}`);
  }
  private updateProgress():void {
    if(this.disposed||!this.shown||this.element.hidden||document.hidden||!this.engine.ready)return;
    const frame=this.scrubbing?Number(this.timeline.value):Math.max(0,Math.min(Number(this.timeline.max),this.frame));
    if(!this.scrubbing&&Number(this.timeline.value)!==frame)this.timeline.value=String(frame);this.updateTime(frame);
  }
  private syncProgressTimer():void {
    const run=!this.disposed&&this.shown&&!this.element.hidden&&!document.hidden&&this.engine.ready&&this.engine.playing;
    if(!run){clearTimeout(this.progressTimer);this.progressTimer=0;return;}
    if(!this.progressTimer)this.progressTimer=window.setTimeout(()=>{this.progressTimer=0;this.updateProgress();this.syncProgressTimer();},100);
  }
  private show():void {if(this.disposed)return;if(!this.shown){this.shown=true;this.element.inert=false;this.element.dataset.visible="true";document.documentElement.classList.remove("player-cursor-hidden");this.updateProgress();}this.syncProgressTimer();this.armHide();}
  private armHide():void {
    clearTimeout(this.hideTimer);
    if(!this.engine.playing||this.scrubbing||!this.menu.hidden||this.hovering||(this.keyboard&&this.element.contains(document.activeElement))||document.hidden)return;
    this.hideTimer=window.setTimeout(()=>{this.shown=false;this.element.dataset.visible="false";this.element.inert=true;this.tooltip.hidden=true;document.documentElement.classList.add("player-cursor-hidden");this.syncProgressTimer();},this.hideDelay);
  }
  private setMenu(open:boolean):void {if(this.menu.hidden===open){this.menu.hidden=!open;this.speedButton?.setAttribute("aria-expanded",String(open));}if(open){this.show();if(this.keyboard)this.speedSlider.focus();}else this.armHide();}
  private setSpeed(speed:number):boolean {try{this.engine.setPlaybackRate(Math.round(speed*100),100);return true;}catch(error){this.failure(error);this.lastSpeed=NaN;this.refreshState();return false;}}
  private toggle():void {this.scrubTicket++;this.resumeAfterScrub=false;if(this.engine.playing)this.engine.pause();else void this.engine.play().catch(error=>this.failure(error));this.show();}
  private step(amount:number):void {this.engine.pause();this.scrubTicket++;const next=Frame.add(this.frame,Frame.from(amount)),end=Frame.from(Number(this.timeline.max));void this.engine.seekFrame(Frame.compare(next,Frame.zero)<0?Frame.zero:Frame.compare(next,end)>0?end:next).catch(error=>this.failure(error));this.show();}
  private async finishScrub():Promise<void> {
    if(!this.scrubbing)return;this.scrubbing=false;const resume=this.resumeAfterScrub,ticket=this.scrubTicket,revision=this.engine.revision;this.resumeAfterScrub=false;
    await this.seekPending;if(this.disposed||ticket!==this.scrubTicket||revision!==this.engine.revision)return;
    if(resume)void this.engine.play().catch(error=>this.failure(error));this.refreshState();this.show();
  }
  private toggleMute():void {const audio=this.engine.audioPlayer;if(audio){audio.setMuted(!audio.muted);this.show();}}
  private async fullscreen():Promise<void> {try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(error){this.failure(error);}}
  private failure(error:unknown):void {if(this.disposed)return;this.feedback.textContent=error instanceof DOMException&&error.name==="NotAllowedError"?"Press play to start audio.":error instanceof Error?error.message:String(error);this.feedback.hidden=false;clearTimeout(this.feedbackTimer);this.feedbackTimer=window.setTimeout(()=>{this.feedback.hidden=true;},3500);this.show();}
  private keydown(event:KeyboardEvent):void {
    if(event.altKey||event.ctrlKey||event.metaKey)return;
    const target=event.target;if(target instanceof HTMLElement&&(target.isContentEditable||/TEXTAREA|SELECT/.test(target.tagName)||target instanceof HTMLInputElement&&target.type!=="range"))return;
    this.keyboard=true;this.show();
    if(event.code==="Escape"&&!this.menu.hidden){event.preventDefault();this.setMenu(false);this.speedButton.focus();return;}
    if(target instanceof HTMLInputElement&&target.type==="range"&&["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"].includes(event.code))return;
    if(!this.menu.hidden&&["ArrowDown","ArrowUp","Home","End"].includes(event.code)){
      event.preventDefault();const buttons=this.presets,index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.code==="Home"?0:event.code==="End"?buttons.length-1:(index+(event.code==="ArrowDown"?1:-1)+buttons.length)%buttons.length].focus();return;
    }
    if(target instanceof HTMLButtonElement&&["Space","Enter"].includes(event.code))return;
    switch(event.code){
      case "Space":case "KeyK":event.preventDefault();if(!event.repeat)this.toggle();break;
      case "Comma":event.preventDefault();this.step(-1);break;case "Period":event.preventDefault();this.step(1);break;
      case "ArrowLeft":case "ArrowRight":case "KeyJ":case "KeyL":{
        event.preventDefault();const direction=event.code==="ArrowLeft"||event.code==="KeyJ"?-1:1,seconds=event.code==="KeyJ"||event.code==="KeyL"?10:5;
        void this.engine.seek(Math.max(0,Math.min(this.engine.duration,this.engine.time+direction*seconds))).catch(error=>this.failure(error));break;
      }
      case "KeyF":event.preventDefault();if(!event.repeat)void this.fullscreen();break;
      case "KeyM":event.preventDefault();if(!event.repeat)this.toggleMute();break;
    }
  }
  dispose():void {if(this.disposed)return;this.disposed=true;this.scrubTicket++;clearTimeout(this.hideTimer);clearTimeout(this.feedbackTimer);clearTimeout(this.progressTimer);this.events.abort();this.unsubscribe();this.element.remove();this.feedback.remove();document.documentElement.classList.remove("player-cursor-hidden");}
}
