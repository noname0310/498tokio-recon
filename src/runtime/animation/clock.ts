import {Frame,Time,frameRate,type FrameTime,type FrameRate,type Rational} from "./time.js";

export type ClockEvent={type:"state"|"duration"|"volume"}|{type:"time";discontinuity:boolean}|{type:"error";error:unknown};
/** Transport owns time. A renderer samples it; it never advances it independently. */
export interface AnimationClock {
  readonly kind:"performance"|"audio";
  /** Last evaluated offset in rational seconds (rate 1), relative to transport start. */
  pauseOffsetHint:FrameTime|undefined;
  readonly currentTime:number;readonly duration:number;readonly playing:boolean;
  readonly playbackRate:number;readonly loop:boolean;readonly seeking:boolean;readonly buffering:boolean;
  sample(rate:FrameRate,now?:number):FrameTime;
  seek(time:FrameTime,rate:FrameRate):Promise<void>;
  play():Promise<void>;pause():void;
  setPlaybackRate(numerator:number,denominator?:number):void;setLoop(enabled:boolean):void;
  subscribe(listener:(event:ClockEvent)=>void):()=>void;dispose():void;
}
export abstract class ObservableClock {
  pauseOffsetHint:FrameTime|undefined;
  private readonly listeners=new Set<(event:ClockEvent)=>void>();
  subscribe(listener:(event:ClockEvent)=>void):()=>void {this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  protected emit(event:ClockEvent):void {for(const listener of this.listeners)listener(event);}
  protected clearListeners():void {this.listeners.clear();}
}
export function playbackRatio(numerator:number,denominator=1):Rational {
  if(!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator)||denominator<=0)throw new Error("Playback rate needs an integer numerator and positive denominator.");
  return Time.rational(BigInt(numerator),BigInt(denominator));
}
const secondsRate=frameRate(1),zero=Time.fromFrame(Frame.zero);

/** Rational anchors preserve exact frame seeks; wall time is sampled in microseconds. */
export class PerformanceClock extends ObservableClock implements AnimationClock {
  readonly kind="performance";readonly seeking=false;readonly buffering=false;
  private position=zero;private anchor=zero;private wall=0n;private running=false;private disposed=false;
  private speed=Time.rational(1n,1n);private looping:boolean;private readonly end:FrameTime;
  constructor(duration:FrameTime,rate:FrameRate,loop=false,private readonly now:()=>number=()=>performance.now()){
    super();this.end=Time.convert(duration,rate,secondsRate);if(Time.compare(this.end,zero)<0)throw new Error("Clock duration must be nonnegative.");this.looping=loop;
  }
  get currentTime():number{return Time.toSeconds(this.position,secondsRate);}
  get duration():number{return Time.toSeconds(this.end,secondsRate);}
  get playing():boolean{return this.running;}
  get playbackRate():number{return Number(this.speed.numerator)/Number(this.speed.denominator);}
  get loop():boolean{return this.looping;}
  private reanchor():void {this.anchor=this.position;this.wall=BigInt(Math.round(this.now()*1000));}
  sample(rate:FrameRate,now=this.now()):FrameTime {
    if(this.running){
      const wall=BigInt(Math.round(now*1000));
      // RAF timestamps can predate play() within the same render interval.
      let position=Time.add(this.anchor,Time.scale(Time.fromMicroseconds(wall>this.wall?wall-this.wall:0n,secondsRate),this.speed));
      if(Time.compare(position,zero)<0||Time.compare(position,this.end)>=0){
        if(this.looping&&this.duration>0){
          // Work in rational seconds, including fractional duration boundaries.
          const n=BigInt(position.frame)*position.subframe.denominator+position.subframe.numerator,d=position.subframe.denominator;
          const en=BigInt(this.end.frame)*this.end.subframe.denominator+this.end.subframe.numerator,ed=this.end.subframe.denominator;
          const divisor=en*d,value=n*ed;
          position=Time.fromRatio(((value%divisor)+divisor)%divisor,d*ed);this.anchor=position;this.wall=wall;
        }else {position=this.speed.numerator<0n?zero:this.end;this.running=false;}
      }
      this.position=position;
    }
    return Time.convert(this.position,secondsRate,rate);
  }
  seek(time:FrameTime,rate:FrameRate):Promise<void> {
    const position=Time.convert(time,rate,secondsRate);if(Time.compare(position,zero)<0)throw new Error("Clock time must be nonnegative.");
    this.pauseOffsetHint=undefined;this.position=position;this.reanchor();this.emit({type:"time",discontinuity:true});return Promise.resolve();
  }
  play():Promise<void> {
    if(!this.disposed&&!this.running&&this.duration>0){
      if(this.speed.numerator<0n&&Time.compare(this.position,zero)<=0){this.position=this.end;this.pauseOffsetHint=undefined;}
      else if(this.speed.numerator>=0n&&Time.compare(this.position,this.end)>=0){this.position=zero;this.pauseOffsetHint=undefined;}
      this.running=true;this.reanchor();this.emit({type:"state"});
    }
    return Promise.resolve();
  }
  pause():void {if(this.running){this.position=this.pauseOffsetHint??this.position;this.running=false;this.emit({type:"state"});}}
  setPlaybackRate(numerator:number,denominator=1):void {this.speed=playbackRatio(numerator,denominator);this.reanchor();this.emit({type:"state"});}
  setLoop(enabled:boolean):void {this.looping=enabled;this.emit({type:"state"});}
  dispose():void {this.pause();this.disposed=true;this.clearListeners();}
}
