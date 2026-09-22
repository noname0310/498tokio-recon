/** Frame indices are checked Int32 values; fractional time never enters a key array. */
declare const frameBrand: unique symbol;
export type FrameNumber = number & { readonly [frameBrand]: never };
export interface FrameRate { readonly numerator: number; readonly denominator: number }
export interface Rational { readonly numerator: bigint; readonly denominator: bigint }
export interface FrameTime { readonly frame: FrameNumber; readonly subframe: Rational }
/** An authored integer frame and its rate. Serialized without a seconds round trip. */
export interface FrameStamp { readonly frame: FrameNumber; readonly rate: FrameRate }

type IntegerInput<N extends number> = number extends N ? unknown :
  [N] extends [FrameNumber] ? unknown : [`${N}`] extends [`${bigint}`] ? unknown : never;

const MIN=-2147483648,MAX=2147483647;
function gcd(a:bigint,b:bigint):bigint {a=a<0n?-a:a;b=b<0n?-b:b;while(b){const r=a%b;a=b;b=r;}return a||1n;}
function rational(numerator:bigint,denominator:bigint):Rational {
  if(!denominator)throw new RangeError("A time denominator cannot be zero.");
  if(denominator<0n){numerator=-numerator;denominator=-denominator;}
  const d=gcd(numerator,denominator);return Object.freeze({numerator:numerator/d,denominator:denominator/d});
}
function from<const N extends number>(value:N & IntegerInput<N>):FrameNumber;
function from(value:number):FrameNumber {
  if(!Number.isInteger(value)||value<MIN||value>MAX)throw new RangeError(`FrameNumber must be an Int32 integer: ${value}`);
  return value as FrameNumber;
}
function checked(n:bigint):FrameNumber {if(n<BigInt(MIN)||n>BigInt(MAX))throw new RangeError("FrameNumber overflow.");return from(Number(n));}
export const Frame={from,zero:from(0),min:from(MIN),max:from(MAX),
  add:(a:FrameNumber,b:FrameNumber):FrameNumber=>checked(BigInt(a)+BigInt(b)),
  subtract:(a:FrameNumber,b:FrameNumber):FrameNumber=>checked(BigInt(a)-BigInt(b)),
  multiply:(a:FrameNumber,b:number):FrameNumber=>{if(!Number.isSafeInteger(b))throw new RangeError("Use FrameTime for fractional multiplication.");return checked(BigInt(a)*BigInt(b));},
  divide:(a:FrameNumber,b:number):FrameNumber=>{if(!Number.isSafeInteger(b)||!b||BigInt(a)%BigInt(b)!==0n)throw new RangeError("Use FrameTime for fractional division.");return checked(BigInt(a)/BigInt(b));},
  compare:(a:FrameNumber,b:FrameNumber):number=>a<b?-1:a>b?1:0,
  next:(a:FrameNumber):FrameNumber=>checked(BigInt(a)+1n),previous:(a:FrameNumber):FrameNumber=>checked(BigInt(a)-1n)
} as const;
export function frameRate(numerator:number,denominator=1):FrameRate {
  if(!Number.isInteger(numerator)||!Number.isInteger(denominator)||numerator<1||denominator<1||numerator>MAX||denominator>MAX)throw new RangeError("Frame rates need positive Int32 numerator/denominator.");
  const r=rational(BigInt(numerator),BigInt(denominator));return Object.freeze({numerator:Number(r.numerator),denominator:Number(r.denominator)});
}
function parts(t:FrameTime):Rational {return {numerator:BigInt(t.frame)*t.subframe.denominator+t.subframe.numerator,denominator:t.subframe.denominator};}
function fromRatio(numerator:bigint,denominator=1n):FrameTime {
  const r=rational(numerator,denominator);let q=r.numerator/r.denominator,rem=r.numerator%r.denominator;if(rem<0n){q--;rem+=r.denominator;}
  return Object.freeze({frame:checked(q),subframe:rational(rem,r.denominator)});
}
function decimal(value:number):Rational {
  if(!Number.isFinite(value))throw new RangeError("Time must be finite.");
  const [mantissa,exponent="0"]=String(value).toLowerCase().split("e"),[whole,fraction=""]=mantissa.split("."),power=Number(exponent)-fraction.length;
  const n=BigInt(whole+fraction);return power>=0?rational(n*10n**BigInt(power),1n):rational(n,10n**BigInt(-power));
}
function combine(a:FrameTime,b:FrameTime,sign:bigint):FrameTime {const x=parts(a),y=parts(b);return fromRatio(x.numerator*y.denominator+sign*y.numerator*x.denominator,x.denominator*y.denominator);}
function scale(t:FrameTime,ratio:Rational):FrameTime {const r=parts(t);return fromRatio(r.numerator*ratio.numerator,r.denominator*ratio.denominator);}
function compare(a:FrameTime,b:FrameTime):number {const x=parts(a),y=parts(b),d=x.numerator*y.denominator-y.numerator*x.denominator;return d<0n?-1:d>0n?1:0;}
export const Time={
  rational,decimal,fromRatio,fromFrame:(frame:FrameNumber):FrameTime=>fromRatio(BigInt(frame)),
  fromDecimal:(value:number):FrameTime=>{const r=decimal(value);return fromRatio(r.numerator,r.denominator);},
  fromSeconds:(seconds:number,rate:FrameRate):FrameTime=>{const r=decimal(seconds);return fromRatio(r.numerator*BigInt(rate.numerator),r.denominator*BigInt(rate.denominator));},
  fromMicroseconds:(microseconds:bigint,rate:FrameRate):FrameTime=>fromRatio(microseconds*BigInt(rate.numerator),1000000n*BigInt(rate.denominator)),
  convert:(t:FrameTime,from:FrameRate,to:FrameRate):FrameTime=>scale(t,rational(BigInt(to.numerator)*BigInt(from.denominator),BigInt(to.denominator)*BigInt(from.numerator))),
  add:(a:FrameTime,b:FrameTime):FrameTime=>combine(a,b,1n),subtract:(a:FrameTime,b:FrameTime):FrameTime=>combine(a,b,-1n),scale,compare,
  floor:(t:FrameTime):FrameNumber=>t.frame,
  ceil:(t:FrameTime):FrameNumber=>t.subframe.numerator?Frame.next(t.frame):t.frame,
  toDecimal:(t:FrameTime):number=>t.frame+Number(t.subframe.numerator)/Number(t.subframe.denominator),
  toSeconds:(t:FrameTime,rate:FrameRate):number=>{const r=parts(t);return Number(r.numerator*BigInt(rate.denominator))/Number(r.denominator*BigInt(rate.numerator));},
  fractionBetween:(t:FrameTime,a:FrameNumber,b:FrameNumber):number=>{const r=parts(t),n=r.numerator-BigInt(a)*r.denominator,d=(BigInt(b)-BigInt(a))*r.denominator;if(d===0n)throw new RangeError("Empty key interval.");return Number(n)/Number(d);},
  wrap:(t:FrameTime,start:FrameNumber,end:FrameNumber):FrameTime=>{if(Frame.compare(start,end)>=0)throw new RangeError("Empty loop range.");const r=parts(t),d=(BigInt(end)-BigInt(start))*r.denominator,n=r.numerator-BigInt(start)*r.denominator;return fromRatio(BigInt(start)*r.denominator+((n%d)+d)%d,r.denominator);},
  key:(t:FrameTime):string=>`${t.frame}:${t.subframe.numerator}/${t.subframe.denominator}`
} as const;
