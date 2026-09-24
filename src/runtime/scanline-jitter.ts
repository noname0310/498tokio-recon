import {Time,frameRate,type FrameTime} from "./animation/time.js";
import {mulberry32} from "./particles.js";
import type {PixelImage,ScanlineJitter} from "./types.js";

export const scanlineRows=2048;
const stride=127;
export function scanlineNoise(seed:number):PixelImage {
  const random=mulberry32(seed),data=new Uint8Array(scanlineRows*4);
  for(let i=0;i<scanlineRows;i++){
    data[4*i]=Math.floor(random()*256);data[4*i+1]=Math.floor(random()*256);
    data[4*i+2]=128;data[4*i+3]=255;
  }
  return {width:1,height:scanlineRows,channels:4,data};
}
/** Random access from exact timeline time, independent of render/seek history.
 * Adjacent noise realizations interpolate, while the spatial rows stay fixed. */
export function scanlinePhase(c:ScanlineJitter,time:FrameTime):{first:number;second:number;mix:number} {
  const elapsed=Time.subtract(time,Time.convert(Time.fromFrame(c.start.frame),c.start.rate,frameRate(1)));
  const phase=Time.scale(elapsed,Time.decimal(c.frequency));
  const first=((phase.frame%scanlineRows)*stride%scanlineRows+scanlineRows)%scanlineRows;
  return {first,second:(first+stride)%scanlineRows,mix:phase.subframe.numerator/phase.subframe.denominator};
}
