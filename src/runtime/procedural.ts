import type { TextureJob, PixelImage } from "./types.js";
/* Pure, scene-independent texture jobs, executed inside Workers. */
export function generateTexture(input:TextureJob):PixelImage {
  "use strict";
  const clamp = (value:number, low:number, high:number) => Math.max(low, Math.min(high, value));

  function kernel(sigma:number) {
    if (sigma <= 0) return new Float64Array([1]);
    // Same finite support as scipy.ndimage.gaussian_filter (truncate = 4).
    const radius = Math.floor(4 * sigma + 0.5);
    const weights = new Float64Array(radius * 2 + 1);
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      weights[i + radius] = Math.exp(-0.5 * (i / sigma) ** 2);
      sum += weights[i + radius];
    }
    for (let i = 0; i < weights.length; i++) weights[i] /= sum;
    return weights;
  }

  function boundaryIndex(index:number, length:number, mode:string) {
    if (mode === "nearest") return clamp(index, 0, length - 1);
    const period = mode === "wrap" ? length : length * 2;
    const wrapped = ((index % period) + period) % period;
    return wrapped < length ? wrapped : period - wrapped - 1;
  }

  function convolve(input:ArrayLike<number>, width:number, height:number, channels:number, weights:Float64Array, axis:string, boundary:string) {
    const output = new Float64Array(input.length);
    const length = axis === "y" ? height : width;
    const radius = (weights.length - 1) / 2;
    const indices = new Int32Array(length * weights.length);
    for (let i = 0; i < length; i++) {
      for (let k = 0; k < weights.length; k++) {
        indices[i * weights.length + k] = boundaryIndex(i + k - radius, length, boundary);
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const destination = (y * width + x) * channels;
        const indexBase = (axis === "y" ? y : x) * weights.length;
        for (let c = 0; c < channels; c++) {
          let sum = 0;
          for (let k = 0; k < weights.length; k++) {
            const mapped = indices[indexBase + k];
            const source = axis === "y" ? mapped * width + x : y * width + mapped;
            sum += input[source * channels + c] * weights[k];
          }
          output[destination + c] = sum;
        }
      }
    }
    return output;
  }

  function blur(input:ArrayLike<number>, width:number, height:number, channels:number, sigmaYX:number[], boundaryYX:string[]) {
    const vertical = convolve(input, width, height, channels, kernel(sigmaYX[0]), "y", boundaryYX[0]);
    return convolve(vertical, width, height, channels, kernel(sigmaYX[1]), "x", boundaryYX[1]);
  }

  function bytes(input:ArrayLike<number>, scale = 1, offset = 0) {
    const output = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      output[i] = Math.round(clamp(input[i] * scale + offset, 0, 255));
    }
    return output;
  }

  function texture(data:Uint8Array, width:number, height:number, channels:number):PixelImage {
    return { data, width, height, channels };
  }

  function randomGenerator(seed:number) {
    // Mulberry32. Explicit integer operations give repeatable browser results.
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), state | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return (((value ^ (value >>> 14)) >>> 0) + 0.5) / 4294967296;
    };
  }

  function normalField(length:number, random:()=>number) {
    const result = new Float64Array(length);
    for (let i = 0; i < length; i += 2) {
      const radius = Math.sqrt(-2 * Math.log(random()));
      const angle = 2 * Math.PI * random();
      result[i] = radius * Math.cos(angle);
      if (i + 1 < length) result[i + 1] = radius * Math.sin(angle);
    }
    return result;
  }

  function normalize(field:Float64Array, targetStd:number) {
    let mean = 0;
    for (const value of field) mean += value;
    mean /= field.length;
    let variance = 0;
    for (const value of field) variance += (value - mean) ** 2;
    const multiplier = targetStd / Math.max(Math.sqrt(variance / field.length), 1e-12);
    for (let i = 0; i < field.length; i++) field[i] = (field[i] - mean) * multiplier;
  }


  const {kind}=input;
  if(kind==="noise"){
    const c=input.component,width=c.textureSize.x,height=c.textureSize.y,random=randomGenerator(c.seed),total=new Float64Array(width*height);
    let variance=0;
    for(const band of c.bands){const field=blur(normalField(total.length,random),width,height,1,[band.sigmaTexels.y,band.sigmaTexels.x],["wrap","wrap"]);normalize(field,Math.sqrt(band.variance));for(let i=0;i<total.length;i++)total[i]+=field[i];variance+=band.variance;}
    normalize(total,Math.sqrt(variance));return texture(bytes(total,127.5/c.range,127.5),width,height,1);
  }
  const {source,asset,resolution}=input;
  if(kind==="tile"){
    const worldWidth=source.width/asset.pixelsPerUnit,worldHeight=source.height/asset.pixelsPerUnit;
    const width=Math.max(source.width,Math.ceil(worldWidth*resolution)),height=Math.max(source.height,Math.ceil(worldHeight*resolution));
    const alpha=source.data.some((value,index)=>index%4===3&&value<255),channels=alpha?4:3;
    const raw=new Float64Array(width*height*channels);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const sx=Math.min(source.width-1,Math.floor((x+.5)/width*source.width)),sy=Math.min(source.height-1,Math.floor((y+.5)/height*source.height));
      const start=(sy*source.width+sx)*4,offset=(y*width+x)*channels,a=alpha?source.data[start+3]/255:1;
      for(let c=0;c<3;c++)raw[offset+c]=source.data[start+c]*a;
      if(alpha)raw[offset+3]=a;
    }
    const sigma=input.sigmaWorld;
    const filtered=blur(raw,width,height,channels,[sigma.y*height/worldHeight,sigma.x*width/worldWidth],[input.repeatY?"wrap":"nearest","wrap"]);
    if(alpha)for(let i=0;i<filtered.length;i+=4){const a=filtered[i+3];for(let c=0;c<3;c++)filtered[i+c]=a>1e-8?filtered[i+c]/a:0;filtered[i+3]=a*255;}
    return texture(bytes(filtered),width,height,channels);
  }
  if(kind==="mask"){
    const c=input.component,worldWidth=source.width/asset.pixelsPerUnit,worldHeight=source.height/asset.pixelsPerUnit;
    // Bounds are derived from the source atlas and blur radius, aligned to the
    // local texture grid. Transparent atlas padding and arbitrary pivots work.
    const pad=4*c.sigmaWorld+1/resolution;
    const left=Math.floor((-asset.pivot.x*worldWidth-pad)*resolution)/resolution;
    const right=Math.ceil(((1-asset.pivot.x)*worldWidth+pad)*resolution)/resolution;
    const bottom=Math.floor((-asset.pivot.y*worldHeight-pad)*resolution)/resolution;
    const top=Math.ceil(((1-asset.pivot.y)*worldHeight+pad)*resolution)/resolution;
    const width=Math.round((right-left)*resolution),height=Math.round((top-bottom)*resolution);
    if(width*height>16777216)throw new Error("Effect texture exceeds the configured texture budget.");
    const mask=new Float64Array(width*height);
    // Integrate texel coverage, rather than point-sampling source boundaries.
    // Odd-sized sprites put these boundaries at mask pixel centers; floor()
    // there both shifts the mask and duplicates/skips cells through roundoff.
    const step=resolution/asset.pixelsPerUnit;
    const startX=(-asset.pivot.x*worldWidth-left)*resolution;
    const startY=(top-(1-asset.pivot.y)*worldHeight)*resolution;
    for(let row=0;row<source.height;row++)for(let col=0;col<source.width;col++){
      const i=(row*source.width+col)*4;let value=source.data[i+3]/255;
      if(c.type==="Glow"){const luma=(.2126*source.data[i]+.7152*source.data[i+1]+.0722*source.data[i+2])/255;value*=clamp((luma-c.threshold)/c.softness,0,1);}
      if(value===0)continue;
      const x0=startX+col*step,x1=startX+(col+1)*step,y0=startY+row*step,y1=startY+(row+1)*step;
      for(let y=Math.max(0,Math.floor(y0));y<Math.min(height,Math.ceil(y1));y++){
        const overlapY=Math.max(0,Math.min(y+1,y1)-Math.max(y,y0));
        for(let x=Math.max(0,Math.floor(x0));x<Math.min(width,Math.ceil(x1));x++){
          const overlapX=Math.max(0,Math.min(x+1,x1)-Math.max(x,x0));
          mask[y*width+x]+=value*overlapX*overlapY;
        }
      }
    }
    const sigma=c.sigmaWorld*resolution;
    const result=texture(bytes(blur(mask,width,height,1,[sigma,sigma],["nearest","nearest"]),255),width,height,1);
    result.bounds={left,right,bottom,top};return result;
  }
  throw new Error(`Unknown texture job: ${kind}`);
}
