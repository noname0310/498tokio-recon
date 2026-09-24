/** Frame indices are checked Int32 values; fractional time never enters a key array. */
declare const frameBrand: unique symbol;
export type FrameNumber = number & { readonly [frameBrand]: never };
export interface FrameRate { readonly numerator: number; readonly denominator: number }
export interface Rational { readonly numerator: number; readonly denominator: number }
export interface FrameTime { readonly frame: FrameNumber; readonly subframe: Rational }
/** An authored integer frame and its rate. Serialized without a seconds round trip. */
export interface FrameStamp { readonly frame: FrameNumber; readonly rate: FrameRate }

type IntegerLiteral<N extends number> = N extends N ? `${N}` extends `${string}.${string}`|`${string}e-${string}` ? never : N : never;
type IntegerInput<N extends number> = number extends N ? unknown :
  [N] extends [FrameNumber] ? unknown : [N] extends [IntegerLiteral<N>] ? unknown : never;
const MIN=-2147483648,MAX=2147483647,SAFE=Number.MAX_SAFE_INTEGER,DECIMAL_RESOLUTION=1000000000;
class TimeIntegerOverflow extends RangeError {constructor(){super("Time arithmetic exceeds the safe integer range.");}}
function integer(n:number):number {if(!Number.isSafeInteger(n))throw new TimeIntegerOverflow();return n;}
function product(a:number,b:number):number {if(a&&Math.abs(b)>SAFE/Math.abs(a))throw new TimeIntegerOverflow();return integer(a*b);}
function gcd(a:number,b:number):number {a=Math.abs(a);b=Math.abs(b);while(b){const r=a%b;a=b;b=r;}return a||1;}
function rational(numerator:number,denominator=1):Rational {
  integer(numerator);integer(denominator);if(!denominator)throw new RangeError("A time denominator cannot be zero.");
  if(denominator<0){numerator=-numerator;denominator=-denominator;}
  const d=gcd(numerator,denominator);return Object.freeze({numerator:numerator/d,denominator:denominator/d});
}
function from<const N extends number>(value:N & IntegerInput<N>):FrameNumber;
function from(value:number):FrameNumber {
  if(!Number.isInteger(value)||value<MIN||value>MAX)throw new RangeError(`FrameNumber must be an Int32 integer: ${value}`);
  return value as FrameNumber;
}
function checked(n:number):FrameNumber {if(!Number.isInteger(n)||n<MIN||n>MAX)throw new RangeError("FrameNumber overflow.");return from(n);}
export const Frame={from,zero:from(0),min:from(MIN),max:from(MAX),
  add:(a:FrameNumber,b:FrameNumber):FrameNumber=>checked(a+b),
  subtract:(a:FrameNumber,b:FrameNumber):FrameNumber=>checked(a-b),
  multiply:(a:FrameNumber,b:number):FrameNumber=>{if(!Number.isSafeInteger(b))throw new RangeError("Use FrameTime for fractional multiplication.");return checked(a*b);},
  divide:(a:FrameNumber,b:number):FrameNumber=>{if(!Number.isSafeInteger(b)||!b||a%b!==0)throw new RangeError("Use FrameTime for fractional division.");return checked(a/b);},
  compare:(a:FrameNumber,b:FrameNumber):number=>a<b?-1:a>b?1:0,
  next:(a:FrameNumber):FrameNumber=>checked(a+1),previous:(a:FrameNumber):FrameNumber=>checked(a-1)
} as const;
export function frameRate(numerator:number,denominator=1):FrameRate {
  if(!Number.isInteger(numerator)||!Number.isInteger(denominator)||numerator<1||denominator<1||numerator>MAX||denominator>MAX)throw new RangeError("Frame rates need positive Int32 numerator/denominator.");
  return rational(numerator,denominator);
}
/** Keep whole frames separate: a large timestamp never multiplies a subframe denominator. */
function fromParts(frame:number,subframe:Rational):FrameTime {
  integer(frame);
  const r=rational(subframe.numerator,subframe.denominator),rem=r.numerator%r.denominator;
  const whole=(r.numerator-rem)/r.denominator;
  return Object.freeze({frame:checked(frame+whole+(rem<0?-1:0)),subframe:rational(rem<0?rem+r.denominator:rem,r.denominator)});
}
function fromRatio(numerator:number,denominator=1):FrameTime {return fromParts(0,rational(numerator,denominator));}
function multiply(a:Rational,b:Rational):Rational {
  const x=gcd(a.numerator,b.denominator),y=gcd(b.numerator,a.denominator);
  return rational(product(a.numerator/x,b.numerator/y),product(a.denominator/y,b.denominator/x));
}
function sum(a:Rational,b:Rational,sign:number):Rational {
  const d=gcd(a.denominator,b.denominator),x=b.denominator/d,y=a.denominator/d;
  return rational(integer(product(a.numerator,x)+sign*product(b.numerator,y)),product(a.denominator,x));
}
function decimal(value:number):Rational {
  if(!Number.isFinite(value))throw new RangeError("Time must be finite.");
  const [mantissa,exponent="0"]=String(value).toLowerCase().split("e"),[whole,fraction=""]=mantissa.split("."),power=Number(exponent)-fraction.length;
  const n=Number(whole+fraction),d=power<0?10**-power:1,num=power>=0?n*10**power:n;
  if(Number.isSafeInteger(num)&&Number.isSafeInteger(d))return rational(num,d);
  // Floating inputs already have finite precision. Exact authored fractions
  // use rational(); this boundary conversion never rounds a fraction to a frame.
  const denominator=Math.min(DECIMAL_RESOLUTION,Math.floor(SAFE/Math.max(1,Math.abs(value)))),scaled=value*denominator;
  let numerator=Math.round(scaled);
  if(!denominator||!Number.isSafeInteger(numerator))throw new RangeError("Time arithmetic exceeds the safe integer range.");
  if(!Number.isInteger(value)&&numerator%denominator===0)numerator+=value<numerator/denominator?-1:1;
  return rational(numerator,denominator);
}
function fromDecimal(value:number):FrameTime {
  if(!Number.isFinite(value))throw new RangeError("Time must be finite.");
  const text=String(value),point=text.indexOf("."),whole=Math.floor(value);
  // Floating observations have an explicit nanoframe sampling resolution.
  // Authored integer/fraction inputs bypass this ingress through fromRatio /
  // fromParts. Truncation never promotes a subframe across a whole-frame key.
  if(point>=0&&!text.includes("e")){
    const digits=text.slice(point+1);
    if(digits.length<=9)return fromParts(Math.trunc(value),rational((value<0?-1:1)*Number(digits),10**digits.length));
  }
  if(Number.isInteger(value))return fromParts(value,rational(0));
  const remainder=Math.min(DECIMAL_RESOLUTION-1,Math.floor((value-whole)*DECIMAL_RESOLUTION));
  return fromParts(whole,rational(remainder,DECIMAL_RESOLUTION));
}
function fromSeconds(seconds:number,rate:FrameRate):FrameTime {
  return scale(fromDecimal(seconds),rational(rate.numerator,rate.denominator));
}
function combine(a:FrameTime,b:FrameTime,sign:number):FrameTime {
  const whole=a.frame+sign*b.frame;
  if(sign>0){
    const complement=rational(b.subframe.denominator-b.subframe.numerator,b.subframe.denominator);
    return compareFractions(a.subframe,complement)>=0?fromParts(whole+1,sum(a.subframe,complement,-1)):fromParts(whole,sum(a.subframe,b.subframe,1));
  }
  if(compareFractions(a.subframe,b.subframe)<0){
    const complement=rational(b.subframe.denominator-b.subframe.numerator,b.subframe.denominator);
    return fromParts(whole-1,sum(a.subframe,complement,1));
  }
  return fromParts(whole,sum(a.subframe,b.subframe,-1));
}
function scale(t:FrameTime,ratio:Rational):FrameTime {
  // Cancel before multiplying, and normalize each part before combining it.
  const whole=multiply(rational(t.frame),ratio),fraction=multiply(t.subframe,ratio);
  // Cancel a negative remainder before checking the final Int32 frame. For
  // example, -(INT32_MIN + 1/2) is still a valid mixed frame time.
  const wholeRem=whole.numerator%whole.denominator,wholeFrame=(whole.numerator-wholeRem)/whole.denominator;
  const fractionRem=fraction.numerator%fraction.denominator,fractionFrame=(fraction.numerator-fractionRem)/fraction.denominator;
  return fromParts(wholeFrame+fractionFrame,sum(rational(wholeRem,whole.denominator),rational(fractionRem,fraction.denominator),1));
}
/** Compare positive fractions by Euclidean division, without cross products. */
function compareFractions(a:Rational,b:Rational):number {
  let an=a.numerator,ad=a.denominator,bn=b.numerator,bd=b.denominator,sign=1;
  for(;;){
    const ar=an%ad,br=bn%bd,aq=(an-ar)/ad,bq=(bn-br)/bd;
    if(aq!==bq)return sign*(aq<bq?-1:1);
    if(!ar||!br)return ar===br?0:sign*(!ar?-1:1);
    an=ad;ad=ar;bn=bd;bd=br;sign=-sign;
  }
}
function compare(a:FrameTime,b:FrameTime):number {return Frame.compare(a.frame,b.frame)||compareFractions(a.subframe,b.subframe);}
function toSeconds(t:FrameTime,rate:FrameRate):number {
  try{
    const n=integer(product(t.frame,t.subframe.denominator)+t.subframe.numerator);
    const seconds=multiply(rational(n,t.subframe.denominator),rational(rate.denominator,rate.numerator));
    return seconds.numerator/seconds.denominator;
  }catch(error){
    if(!(error instanceof TimeIntegerOverflow))throw error;
    return (t.frame+t.subframe.numerator/t.subframe.denominator)*rate.denominator/rate.numerator;
  }
}
function wrap(t:FrameTime,start:FrameNumber,end:FrameNumber):FrameTime {
  if(start>=end)throw new RangeError("Empty loop range.");
  const span=end-start,relative=t.frame-start;
  return fromParts(start+((relative%span)+span)%span,t.subframe);
}
function modulo(t:FrameTime,period:FrameTime):FrameTime {
  if(period.frame<0||(!period.frame&&!period.subframe.numerator))throw new RangeError("Empty loop range.");
  // A double estimates the quotient; exact comparisons settle either boundary.
  const divisor=period.frame+period.subframe.numerator/period.subframe.denominator;
  const q=Math.floor((t.frame+t.subframe.numerator/t.subframe.denominator)/divisor);
  let value=combine(t,scale(period,rational(integer(q))),-1);
  if(value.frame<0)value=combine(value,period,1);
  if(compare(value,period)>=0)value=combine(value,period,-1);
  return value;
}
export const Time={
  rational,decimal,fromRatio,fromParts,fromDecimal,fromFrame:(frame:FrameNumber):FrameTime=>fromParts(frame,rational(0)),
  fromSeconds,
  fromMicroseconds:(microseconds:number,rate:FrameRate):FrameTime=>scale(fromRatio(microseconds,1000000),rational(rate.numerator,rate.denominator)),
  convert:(t:FrameTime,from:FrameRate,to:FrameRate):FrameTime=>scale(t,multiply(rational(to.numerator,to.denominator),rational(from.denominator,from.numerator))),
  add:(a:FrameTime,b:FrameTime):FrameTime=>combine(a,b,1),subtract:(a:FrameTime,b:FrameTime):FrameTime=>combine(a,b,-1),scale,compare,
  floor:(t:FrameTime):FrameNumber=>t.frame,ceil:(t:FrameTime):FrameNumber=>t.subframe.numerator?Frame.next(t.frame):t.frame,
  toDecimal:(t:FrameTime):number=>t.frame+t.subframe.numerator/t.subframe.denominator,
  toSeconds,
  fractionBetween:(t:FrameTime,a:FrameNumber,b:FrameNumber):number=>{if(a===b)throw new RangeError("Empty key interval.");return ((t.frame-a)+t.subframe.numerator/t.subframe.denominator)/(b-a);},
  wrap,modulo,key:(t:FrameTime):string=>`${t.frame}:${t.subframe.numerator}/${t.subframe.denominator}`
} as const;
