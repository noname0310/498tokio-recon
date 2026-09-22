import type { Flicker } from "./types.js";
import { mulberry32 } from "./particles.js";
import {Time,frameRate,type FrameTime} from "./animation/time.js";

/** Stateless visibility; random slots can repeat, producing irregular on/off runs. */
export function flickerVisible(component:Flicker,time:FrameTime|number):boolean {
  const position=typeof time==="number"?Time.fromDecimal(time):time;
  const elapsed=Time.subtract(position,Time.convert(Time.fromFrame(component.start.frame),component.start.rate,frameRate(1)));
  if(elapsed.frame<0)return false;
  const cycles=Time.add(Time.scale(elapsed,Time.decimal(component.frequency)),Time.fromDecimal(component.phase));
  if(component.mode==="periodic")return Time.compare(Time.fromRatio(cycles.subframe.numerator,cycles.subframe.denominator),Time.fromDecimal(component.dutyCycle))<0;
  const slot=Time.floor(cycles),seed=(component.seed^Math.imul(slot,0x9E3779B1)^Math.floor(slot/4294967296))>>>0;
  return mulberry32(seed)()<component.probability;
}
