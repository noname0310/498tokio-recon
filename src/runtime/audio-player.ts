import {Time,frameRate,type FrameTime,type FrameRate} from "./animation/time.js";
import {ObservableClock,playbackRatio,type AnimationClock} from "./animation/clock.js";
import type {AudioPlayerComponent} from "./types.js";

const secondsRate=frameRate(1);

/** Audio owns transport; a performance clock interpolates between media time hints. */
export class AudioPlayer extends ObservableClock implements AnimationClock {
  readonly kind="audio";readonly element:HTMLAudioElement;readonly ready:Promise<void>;
  private readonly events=new AbortController();private disposed=false;private waiting=false;
  private finishReady:()=>void=()=>{};private finishSeek:()=>void=()=>{};
  private static mediaOwner:AudioPlayer|undefined;
  private readonly mediaActions:MediaSessionAction[]=[];
  private position=0;private wall=0;private mediaHint=0;private correction=1;private advancing=false;private awaitingProgress=true;
  private pausePending=false;private ownedSeekEvents=0;
  // A media element can quantize a requested frame's seconds. Retain its exact
  // rational time until the observed media position actually changes.
  private seekAnchor:{time:FrameTime;rate:FrameRate;seconds:number;mediaSeconds:number|undefined;pending:boolean}|undefined;
  // MmdRuntime.beforePhysics uses a 50 ms dead band, +/-10% catch-up and a
  // 500 ms resync threshold. Pause retains the consumer's last evaluated offset.
  private static readonly syncTolerance=.05;private static readonly snapTolerance=.5;
  constructor(readonly entityId:string,url:string,readonly component:AudioPlayerComponent,host:HTMLElement,private readonly now:()=>number=()=>performance.now()){
    super();const audio=this.element=new Audio();audio.preload="metadata";audio.hidden=true;
    audio.dataset.entity=entityId;audio.dataset.component="AudioPlayer";
    audio.volume=component.volume;audio.muted=component.muted;audio.loop=component.loop;audio.preservesPitch=component.preservesPitch;
    const options={signal:this.events.signal};
    this.ready=new Promise<void>((resolve,reject)=>{
      this.finishReady=resolve;audio.addEventListener("loadedmetadata",()=>{this.synchronize();resolve();this.emit({type:"duration"});},options);
      audio.addEventListener("error",()=>{this.advancing=false;this.synchronize();const error=new Error(`Could not load audio: ${audio.error?.message||url}`);reject(error);this.finishSeek();this.emit({type:"error",error});},options);
    });
    // An unreferenced AudioPlayer can preload without creating an unhandled rejection.
    void this.ready.catch(()=>{});
    for(const event of ["play","pause","ended","ratechange","playing","waiting","stalled","canplay"]){
      audio.addEventListener(event,()=>{
        // A queued pause event can arrive after a new play request.
        if(event==="pause"&&!audio.paused)return;
        if((event==="play"||event==="playing")&&!audio.paused)this.pausePending=true;
        // A stalled download can still have enough buffered audio to play.
        if(event==="stalled"&&audio.readyState>=HTMLMediaElement.HAVE_FUTURE_DATA)return;
        if(event==="waiting"||event==="stalled"){this.waiting=true;this.advancing=false;}
        if(event==="play")this.advancing=!this.waiting&&audio.readyState>=HTMLMediaElement.HAVE_FUTURE_DATA;
        if(event==="playing"){this.waiting=false;this.advancing=true;}
        if(event==="pause"||event==="ended"){this.waiting=false;this.advancing=false;this.applyPauseOffsetHint();}
        if(event==="play"||event==="playing"||event==="waiting"||event==="stalled")this.awaitingProgress=true;
        // canplay announces readiness; playing is the actual buffering resume.
        if(event!=="canplay")this.synchronize();
        this.updateMediaSession();this.emit({type:"state"});
      },options);
    }
    for(const event of ["seeking","seeked","timeupdate"]){audio.addEventListener(event,()=>{
      // Completion from an older request may still be queued after a new seek.
      if(event==="seeked"&&(audio.seeking||this.ownedSeekEvents>0))return;
      if(event!=="timeupdate"){
        if(event==="seeking"){
          this.pauseOffsetHint=undefined;
          // Seeking events are queued, so the decoder may already have settled
          // by delivery. Match our assignments by event, not rounded timestamps.
          if(this.ownedSeekEvents>0)this.ownedSeekEvents--;else this.seekAnchor=undefined;
        }
        if(event==="seeked"&&this.seekAnchor?.pending){
          // Decoder settlement may quantize again, with timeupdate preceding
          // seeked. It completes the same seek; it is not playback progression.
          this.seekAnchor.mediaSeconds=audio.currentTime;this.seekAnchor.pending=false;
        }
        this.awaitingProgress=true;
        this.advancing=event==="seeked"&&this.playing&&!this.waiting&&audio.readyState>=HTMLMediaElement.HAVE_FUTURE_DATA;
        this.synchronize();if(event==="seeked")this.finishSeek();
      }
      this.updateMediaSession();this.emit({type:"time",discontinuity:event!=="timeupdate"});
    },options);}
    audio.addEventListener("durationchange",()=>{this.updateMediaSession();this.emit({type:"duration"});},options);
    audio.addEventListener("volumechange",()=>{component.volume=audio.volume;component.muted=audio.muted;this.emit({type:"volume"});},options);
    audio.src=url;host.append(audio);audio.load();
  }
  get currentTime():number{return this.readTime(this.now());}
  get duration():number{return Number.isFinite(this.element.duration)?this.element.duration:0;}
  get playing():boolean{return !this.element.paused&&!this.element.ended;}
  get playbackRate():number{return this.element.playbackRate;}
  get loop():boolean{return this.element.loop;}
  get seeking():boolean{return this.element.seeking;}
  get buffering():boolean{return this.waiting;}
  get volume():number{return this.element.volume;}
  get muted():boolean{return this.element.muted;}
  setVolume(value:number):void {if(!Number.isFinite(value)||value<0||value>1)throw new Error("Volume must be between zero and one.");this.element.volume=value;}
  setMuted(value:boolean):void {this.element.muted=value;}
  private synchronize(seconds=this.element.currentTime,now=this.now()):void {
    const anchor=this.seekAnchor;
    if(anchor){
      anchor.mediaSeconds??=seconds;
      if(!anchor.pending&&seconds!==anchor.mediaSeconds)this.seekAnchor=undefined;
    }
    this.position=this.seekAnchor?.seconds??seconds;this.mediaHint=seconds;this.wall=now;this.correction=1;
  }
  private readTime(now:number):number {
    if(this.disposed)return this.position;
    const audio=this.element;
    // Native pause queues timeupdate before pause. Hold the displayed offset
    // before either event (or another getter) can overwrite it with media time.
    if(audio.paused)this.applyPauseOffsetHint();else if(!audio.ended)this.pausePending=true;
    if(!this.advancing||!this.playing||this.waiting||audio.seeking){this.synchronize(audio.currentTime,Math.max(now,this.wall));return this.position;}
    // An event/getter may have sampled later than this frame's RAF timestamp.
    if(now<this.wall)return this.position;
    const media=audio.currentTime;
    // A completed seek / playing event can precede audible playback. Do not
    // count decoder/output startup time as animation time. The first moving
    // media sample establishes the new wall anchor; later coarse hints retain
    // smooth interpolation as usual.
    if(this.awaitingProgress){
      const moved=media!==this.mediaHint;
      this.synchronize(media,now);if(moved)this.awaitingProgress=false;
      return this.position;
    }
    const elapsed=(now-this.wall)/1000;
    this.position+=elapsed*this.playbackRate*this.correction;this.wall=now;
    // Some browsers expose media time in coarse steps. Repeated values are
    // stale observations, not evidence that playback has stopped.
    if(media!==this.mediaHint){
      const difference=media-this.position,magnitude=Math.abs(difference);
      if(media<this.mediaHint||magnitude>=AudioPlayer.snapTolerance)this.synchronize(media,now);
      else this.correction=magnitude<AudioPlayer.syncTolerance?1:difference<0?.9:1.1;
      this.mediaHint=media;
    }
    this.position=Math.max(0,this.duration>0?Math.min(this.duration,this.position):this.position);
    return this.position;
  }
  sample(rate:FrameRate,now=this.now()):FrameTime {
    const seconds=this.readTime(now),anchor=this.seekAnchor;
    return anchor?Time.convert(anchor.time,anchor.rate,rate):Time.fromSeconds(seconds,rate);
  }
  seek(time:FrameTime,rate:FrameRate):Promise<void> {
    const seconds=Time.toSeconds(time,rate);
    if(!Number.isFinite(seconds)||seconds<0)throw new Error("Audio time must be finite and nonnegative.");
    if(this.disposed)return Promise.resolve();
    this.pauseOffsetHint=undefined;
    if(this.element.readyState<1)return this.ready.then(()=>this.seek(time,rate));
    const target=Math.min(this.duration,seconds);this.finishSeek();
    this.seekAnchor={time:target<seconds?Time.fromSeconds(target,rate):time,rate,seconds:target,mediaSeconds:undefined,pending:true};
    this.awaitingProgress=true;
    if(target===this.element.currentTime&&!this.seeking){this.seekAnchor.pending=false;this.synchronize(target);this.emit({type:"time",discontinuity:true});return Promise.resolve();}
    return new Promise<void>(resolve=>{
      this.finishSeek=()=>{this.finishSeek=()=>{};resolve();};
      this.ownedSeekEvents++;this.element.currentTime=target;this.synchronize();this.emit({type:"time",discontinuity:true});if(!this.seeking)this.finishSeek();
    });
  }
  seekSeconds(seconds:number):Promise<void> {
    return this.seek(Time.fromSeconds(seconds,secondsRate),secondsRate);
  }
  play():Promise<void> {
    if(this.disposed)return Promise.resolve();
    this.pausePending=true;
    if(this.element.ended){this.pauseOffsetHint=undefined;this.element.currentTime=0;this.synchronize(0);}
    return this.element.play();
  }
  private applyPauseOffsetHint():void {
    if(!this.pausePending||!this.element.paused)return;
    this.pausePending=false;
    const hint=this.pauseOffsetHint;
    // An explicit seek or natural end takes precedence over an older pose.
    if(hint&&!this.element.ended&&!this.seeking)void this.seek(hint,secondsRate).catch(error=>this.emit({type:"error",error}));
  }
  pause():void {this.element.pause();this.advancing=false;this.applyPauseOffsetHint();this.synchronize();}
  setPlaybackRate(numerator:number,denominator=1):void {
    const ratio=playbackRatio(numerator,denominator),value=Number(ratio.numerator)/Number(ratio.denominator);
    if(value<=0)throw new Error("Native audio playback requires a positive rate.");this.element.playbackRate=value;this.synchronize();
  }
  setLoop(enabled:boolean):void {this.component.loop=this.element.loop=enabled;this.emit({type:"state"});}
  activateMediaSession():void {
    if(!("mediaSession" in navigator))return;
    AudioPlayer.mediaOwner=this;const session=navigator.mediaSession;
    if(typeof MediaMetadata!=="undefined")session.metadata=new MediaMetadata({title:this.component.title,artist:this.component.artist,album:this.component.album});
    const action=(name:MediaSessionAction,fn:(details:MediaSessionActionDetails)=>void)=>{try{session.setActionHandler(name,fn);this.mediaActions.push(name);}catch{/* Unsupported platform action. */}};
    action("play",()=>{void this.play().catch(error=>this.emit({type:"error",error}));});action("pause",()=>this.pause());
    action("stop",()=>{this.pause();void this.seekSeconds(0);});
    action("seekto",d=>{if(d.seekTime!==undefined)void this.seekSeconds(d.seekTime);});
    action("seekbackward",d=>{void this.seekSeconds(Math.max(0,this.currentTime-(d.seekOffset??10)));});
    action("seekforward",d=>{void this.seekSeconds(this.currentTime+(d.seekOffset??10));});this.updateMediaSession();
  }
  private updateMediaSession():void {
    if(AudioPlayer.mediaOwner!==this||!("mediaSession" in navigator))return;
    const session=navigator.mediaSession;session.playbackState=this.playing?"playing":"paused";
    if(session.setPositionState&&this.duration>0&&this.playbackRate>0)try{session.setPositionState({duration:this.duration,position:Math.max(0,Math.min(this.duration,this.currentTime)),playbackRate:this.playbackRate});}catch{/* Some platforms expose incomplete position-state support. */}
  }
  dispose():void {
    if(this.disposed)return;this.synchronize();this.advancing=false;this.disposed=true;this.events.abort();this.finishReady();this.finishSeek();
    if(AudioPlayer.mediaOwner===this){AudioPlayer.mediaOwner=undefined;if("mediaSession" in navigator){for(const action of this.mediaActions)navigator.mediaSession.setActionHandler(action,null);navigator.mediaSession.playbackState="none";navigator.mediaSession.metadata=null;}}
    this.element.pause();this.element.removeAttribute("src");this.element.load();this.element.remove();this.clearListeners();
  }
}
