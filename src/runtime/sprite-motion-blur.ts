import type {Bounds,SpriteMotionBlur} from "./types.js";
const cache=new Map<number,Float32Array>();
export function motionSamples(count:number):Float32Array {
  let samples=cache.get(count);if(samples)return samples;
  samples=new Float32Array(count*2);let total=0;
  for(let i=0;i<count;i++){const t=2*i/(count-1)-1,w=Math.exp(-2*t*t);samples[i*2]=t;samples[i*2+1]=w;total+=w;}
  for(let i=0;i<count;i++)samples[i*2+1]/=total;cache.set(count,samples);return samples;
}
export function motionBounds(art:Bounds,c:SpriteMotionBlur,pixelsPerUnit:number):Bounds {
  const filtered=c.dilationPixels>0||c.softnessPixels>0;
  const pad=(c.dilationPixels+4*c.softnessPixels+(filtered?.0625:0))/pixelsPerUnit;
  const b={left:art.left-pad,right:art.right+pad,bottom:art.bottom-pad,top:art.top+pad},out={...b};
  for(const t of [-1,1])for(const x of [b.left,b.right])for(const y of [b.bottom,b.top]){
    const px=c.center.x+(x-c.center.x)*(1+t*c.radialAmount)+t*c.translationWorld.x,py=c.center.y+(y-c.center.y)*(1+t*c.radialAmount)+t*c.translationWorld.y;
    out.left=Math.min(out.left,px);out.right=Math.max(out.right,px);out.bottom=Math.min(out.bottom,py);out.top=Math.max(out.top,py);
  }return out;
}
