import {Time,frameRate,type FrameTime} from "./animation/time.js";
import type {Transform,TransformNoise} from "./types.js";

function random(seed:number,index:number,channel:number):number {
  let v=(seed^Math.imul(index,0x9e3779b1)^Math.imul(channel+1,0x85ebca6b))>>>0;
  v=Math.imul(v^(v>>>16),0x85ebca6b);v=Math.imul(v^(v>>>13),0xc2b2ae35);
  return ((v^(v>>>16))>>>0)/2147483648-1;
}
function noise(seed:number,phase:number,channel:number):number {
  const index=Math.floor(phase),t=phase-index,u=t*t*t*(t*(t*6-15)+10);
  return random(seed,index,channel)*(1-u)+random(seed,index+1,channel)*u;
}
/** Absolute-time sampling makes seeking, paused redraws and exposure sampling
 * independent of render frequency, traversal order and previous evaluations. */
export function applyTransformNoise(transform:Transform,c:TransformNoise,time:FrameTime):Transform {
  const elapsed=Time.subtract(time,Time.convert(Time.fromFrame(c.start.frame),c.start.rate,frameRate(1)));
  const seconds=Time.toDecimal(elapsed);
  if(seconds<0||seconds>=c.duration||c.strength===0)return transform;
  const phase=seconds*c.frequency,position={...transform.localPosition},rotation={...transform.localRotation};
  for(const [i,axis] of (["x","y","z"] as const).entries()){
    position[axis]+=noise(c.seed,phase,i)*c.positionAmplitude[axis]*c.strength;
    rotation[axis]+=noise(c.seed,phase,i+3)*c.rotationAmplitude[axis]*c.strength;
  }
  return {localPosition:position,localRotation:rotation,localScale:transform.localScale};
}
