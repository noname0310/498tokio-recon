import { Frame, Time, frameRate, type FrameNumber, type FrameTime, type FrameRate } from "./time.js";

export const Interpolation={Step:0,Linear:1,FCurve:2} as const;
export type InterpolationMode=typeof Interpolation[keyof typeof Interpolation];
declare const packedModesBrand:unique symbol;
export type PackedInterpolationModes=number&{readonly [packedModesBrand]:never};
/** Two two-bit tags in one Int32. Bits 4..31 and tag 3 are reserved. */
export function packInterpolationModes(inMode:InterpolationMode,outMode:InterpolationMode):PackedInterpolationModes {
  if(![0,1,2].includes(inMode)||![0,1,2].includes(outMode))throw new Error("Invalid interpolation mode.");
  return (inMode|(outMode<<2)) as PackedInterpolationModes;
}
export const inInterpolationMode=(packed:PackedInterpolationModes):InterpolationMode=>(packed&3) as InterpolationMode;
export const outInterpolationMode=(packed:PackedInterpolationModes):InterpolationMode=>((packed>>>2)&3) as InterpolationMode;
export type TrackType="AnimationTrackFloat32"|"AnimationTrackInt32"|"AnimationTrackBoolean";
export interface TrackData {
  type:TrackType;frameNumber:number[];value:number[];interpolation?:number[];interpolationParameters?:number[];defaultValue?:number;
}
export interface KeyOptions {inMode?:InterpolationMode;outMode?:InterpolationMode;inTangent?:number;outTangent?:number;inWeight?:number;outWeight?:number}
export interface Keyframe<T extends number|boolean> extends KeyOptions {frame:FrameNumber;value:T}
export const INTERPOLATION_STRIDE=2;
// Per key: Int32 [mode bits, Float32 parameter index]. No curves => index -1.
// Parameters: [tangent, weight] for each FCurve side, in then out, without padding.
// Tangents are value/tick. Weights are handle lengths in (seconds,value) space;
// -1 requests the unweighted one-third handle, as in Sequencer.
type Values=Float32Array|Int32Array|Uint8Array;
const bezier=(a:number,b:number,c:number,d:number,t:number):number=>{const u=1-t;return u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d;};

/** Solve time first, then value. Choose the largest in-range root like UE 5.3.
 * Derivative intervals handle crossed/long weighted handles without assuming monotonicity. */
export function weightedBezier(alpha:number,x1:number,y1:number,x2:number,y2:number,y0:number,y3:number):number {
  const a=3*x1-3*x2+1,b=-6*x1+3*x2,c=3*x1,knots=[0,1];
  if(Math.abs(a)<1e-14){if(Math.abs(b)>1e-14){const t=-c/(2*b);if(t>0&&t<1)knots.push(t);}}
  else {const discriminant=4*b*b-12*a*c;if(discriminant>=0)for(const t of [(-2*b-Math.sqrt(discriminant))/(6*a),(-2*b+Math.sqrt(discriminant))/(6*a)])if(t>0&&t<1)knots.push(t);}
  knots.sort((a,b)=>a-b);let root=0;
  for(let i=0;i<knots.length-1;i++){
    let lo=knots[i],hi=knots[i+1],left=bezier(0,x1,x2,1,lo)-alpha,right=bezier(0,x1,x2,1,hi)-alpha;
    if(Math.abs(left)<1e-13)root=Math.max(root,lo);if(Math.abs(right)<1e-13)root=Math.max(root,hi);
    if(left*right>=0)continue;
    for(let j=0;j<52;j++){const mid=(lo+hi)/2,value=bezier(0,x1,x2,1,mid)-alpha;if((value<0)===(left<0)){lo=mid;left=value;}else hi=mid;}
    root=Math.max(root,(lo+hi)/2);
  }
  return bezier(y0,y1,y2,y3,root);
}

export abstract class AnimationTrack<T extends number|boolean,V extends Values=Values> {
  abstract readonly type:TrackType;
  readonly frameNumber:Int32Array;
  readonly value:V;
  readonly interpolation:Int32Array;
  readonly interpolationParameters:Float32Array;
  readonly defaultValue:T|undefined;
  private cursor=0;
  protected constructor(data:TrackData,kind:TrackType,storage:(values:number[])=>V){
    const count=data.frameNumber.length;
    if(data.value.length!==count)throw new Error("Key times and values must have equal length.");
    for(let i=0;i<count;i++){Frame.from(data.frameNumber[i]);if(i&&data.frameNumber[i]<=data.frameNumber[i-1])throw new Error("Key frame numbers must increase strictly.");}
    const boolean=kind==="AnimationTrackBoolean",integer=kind==="AnimationTrackInt32";
    const validate=(v:number)=>{if(!Number.isFinite(v)||(boolean&&v!==0&&v!==1)||(integer&&(!Number.isInteger(v)||v<Frame.min||v>Frame.max))||(!integer&&!boolean&&!Number.isFinite(Math.fround(v))))throw new Error(`Invalid ${kind} value.`);};
    data.value.forEach(validate);if(data.defaultValue!==undefined)validate(data.defaultValue);
    this.frameNumber=Int32Array.from(data.frameNumber);this.value=storage(data.value);
    this.defaultValue=data.defaultValue===undefined?undefined:(boolean?Boolean(data.defaultValue):integer?data.defaultValue:Math.fround(data.defaultValue)) as T;
    const metadata=data.interpolation??Array.from({length:count*INTERPOLATION_STRIDE},(_,i)=>i%2?-1:boolean?0:5);
    if(metadata.length!==count*INTERPOLATION_STRIDE)throw new Error("Interpolation needs two Int32 entries per key.");
    const parameters=data.interpolationParameters??[];
    if(parameters.length%2)throw new Error("Curve parameters need tangent/weight pairs.");
    this.interpolationParameters=Float32Array.from(parameters);
    for(let i=0;i<this.interpolationParameters.length;i++){
      const value=this.interpolationParameters[i];
      if(!Number.isFinite(value)||(i%2===1&&value<0&&value!==-1))throw new Error("Invalid curve tangent or weight.");
    }
    for(let key=0;key<count;key++){
      const mode=metadata[key*2],index=metadata[key*2+1];
      if(!Number.isInteger(mode)||mode<0||mode>15||(mode&3)===3||((mode>>>2)&3)===3||(boolean&&mode!==0))throw new Error("Invalid interpolation mode bitfield.");
      const size=((mode&3)===Interpolation.FCurve?2:0)+(((mode>>>2)&3)===Interpolation.FCurve?2:0);
      if(!Number.isInteger(index)||index>Frame.max||(size?(index<0||index%2!==0||index+size>parameters.length):index!==-1))throw new Error("Invalid interpolation parameter index.");
    }
    this.interpolation=Int32Array.from(metadata);
  }
  get byteLength():number{return this.frameNumber.byteLength+this.value.byteLength+this.interpolation.byteLength+this.interpolationParameters.byteLength;}
  private interval(time:FrameTime):number {
    const frame=time.frame,n=this.frameNumber.length,i=this.cursor;
    if(i<n-1&&Frame.compare(frame,Frame.from(this.frameNumber[i]))>=0&&Frame.compare(frame,Frame.from(this.frameNumber[i+1]))<0)return i;
    let low=0,high=n;while(low<high){const mid=(low+high)>>>1;if(Frame.compare(Frame.from(this.frameNumber[mid]),frame)<=0)low=mid+1;else high=mid;}
    this.cursor=Math.max(0,low-1);return this.cursor;
  }
  protected numeric(time:FrameTime,rate:FrameRate):number|undefined {
    const n=this.frameNumber.length;if(!n)return this.defaultValue===undefined?undefined:Number(this.defaultValue);
    if(Time.compare(time,Time.fromFrame(Frame.from(this.frameNumber[0])))<=0)return this.value[0];
    if(Time.compare(time,Time.fromFrame(Frame.from(this.frameNumber[n-1])))>=0)return this.value[n-1];
    const i=this.interval(time),a=Frame.from(this.frameNumber[i]),b=Frame.from(this.frameNumber[i+1]),start=this.value[i],end=this.value[i+1];
    if(Frame.compare(time.frame,a)===0&&time.subframe.numerator===0n)return start;
    const bits=this.interpolation[i*2],out=(bits>>>2)&3,incoming=this.interpolation[(i+1)*2]&3;
    if(out===Interpolation.Step||incoming===Interpolation.Step)return start;
    const alpha=Time.fractionBetween(time,a,b),dt=Number(BigInt(b)-BigInt(a));
    if(out===Interpolation.Linear&&incoming===Interpolation.Linear)return start+(end-start)*alpha;
    const seconds=dt*rate.denominator/rate.numerator,chord=(end-start)/dt;
    const handle=(mode:number,index:number)=>{
      const tangent=mode===Interpolation.Linear?chord:this.interpolationParameters[index],weight=mode===Interpolation.Linear?-1:this.interpolationParameters[index+1];
      const slope=tangent*rate.numerator/rate.denominator;
      const length=mode===Interpolation.Linear||weight<0?Math.hypot(seconds,slope*seconds)/3:weight;
      const dx=length/Math.hypot(1,slope);return {x:dx/seconds,y:dx*slope};
    };
    const left=handle(out,this.interpolation[i*2+1]+((bits&3)===Interpolation.FCurve?2:0)),right=handle(incoming,this.interpolation[(i+1)*2+1]);
    return weightedBezier(alpha,left.x,start+left.y,1-right.x,end-right.y,start,end);
  }
  abstract evaluate(time:FrameTime,rate?:FrameRate):T|undefined;
  toJSON():TrackData{return {type:this.type,frameNumber:Array.from(this.frameNumber),value:Array.from(this.value),interpolation:Array.from(this.interpolation),interpolationParameters:Array.from(this.interpolationParameters),...(this.defaultValue===undefined?{}:{defaultValue:Number(this.defaultValue)})};}
}
export class AnimationTrackFloat32 extends AnimationTrack<number,Float32Array> {
  readonly type="AnimationTrackFloat32";
  constructor(data:Omit<TrackData,"type">){super({...data,type:"AnimationTrackFloat32"},"AnimationTrackFloat32",values=>Float32Array.from(values));}
  evaluate(time:FrameTime,rate=frameRate(30)):number|undefined {const value=this.numeric(time,rate);return value===undefined?undefined:Math.fround(value);}
}
export class AnimationTrackInt32 extends AnimationTrack<number,Int32Array> {
  readonly type="AnimationTrackInt32";
  constructor(data:Omit<TrackData,"type">){super({...data,type:"AnimationTrackInt32"},"AnimationTrackInt32",values=>Int32Array.from(values));}
  evaluate(time:FrameTime,rate=frameRate(30)):number|undefined {const value=this.numeric(time,rate);return value===undefined?undefined:Math.max(Frame.min,Math.min(Frame.max,Math.round(value)));}
}
export class AnimationTrackBoolean extends AnimationTrack<boolean,Uint8Array> {
  readonly type="AnimationTrackBoolean";
  constructor(data:Omit<TrackData,"type">){super({...data,type:"AnimationTrackBoolean"},"AnimationTrackBoolean",values=>Uint8Array.from(values));}
  evaluate(time:FrameTime,rate=frameRate(30)):boolean|undefined {const value=this.numeric(time,rate);return value===undefined?undefined:Boolean(value);}
}
export function createTrack(data:TrackData):AnimationTrack<number|boolean>{
  switch(data.type){case "AnimationTrackFloat32":return new AnimationTrackFloat32(data);case "AnimationTrackInt32":return new AnimationTrackInt32(data);case "AnimationTrackBoolean":return new AnimationTrackBoolean(data);default:throw new Error("Unsupported animation track type.");}
}
export function trackData(type:TrackType,keys:ReadonlyArray<Keyframe<number|boolean>>):TrackData {
  const mode=type==="AnimationTrackBoolean"?Interpolation.Step:Interpolation.Linear;
  const interpolation:number[]=[],interpolationParameters:number[]=[];
  for(const key of keys){
    const incoming=key.inMode??mode,out=key.outMode??mode,index=interpolationParameters.length;
    if(incoming===Interpolation.FCurve)interpolationParameters.push(key.inTangent??0,key.inWeight??-1);
    if(out===Interpolation.FCurve)interpolationParameters.push(key.outTangent??0,key.outWeight??-1);
    interpolation.push(packInterpolationModes(incoming,out),interpolationParameters.length===index?-1:index);
  }
  return {type,frameNumber:keys.map(k=>k.frame),value:keys.map(k=>Number(k.value)),interpolation,interpolationParameters};
}
