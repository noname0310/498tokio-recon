/** A retained, resolution-independent Gaussian rectangle mask. The browser
 * shares the decoded SVG across particles; motion and tint stay in the DOM. */
const cache=new Map<string,string>();
export function rectangleBlurMask(width:number,height:number,padX:number,padY:number,sigmaX:number,sigmaY:number,dilation:number):string {
  const key=[width,height,padX,padY,sigmaX,sigmaY,dilation].join('/');let mask=cache.get(key);
  if(mask)return mask;
  const w=width+2*padX,h=height+2*padY,resolution=128/Math.min(width,height);
  const bounds=`x="${-padX}" y="${-padY}" width="${w}" height="${h}"`;
  const art=`<svg xmlns="http://www.w3.org/2000/svg" width="${w*resolution}" height="${h*resolution}" viewBox="${-padX} ${-padY} ${w} ${h}" preserveAspectRatio="none"><defs><filter id="b" filterUnits="userSpaceOnUse" ${bounds}><feGaussianBlur stdDeviation="${sigmaX} ${sigmaY}"/></filter></defs><rect x="${-dilation}" y="${-dilation}" width="${width+2*dilation}" height="${height+2*dilation}" fill="white" filter="url(#b)"/></svg>`;
  mask=`url("data:image/svg+xml,${encodeURIComponent(art)}")`;
  cache.set(key,mask);if(cache.size>128)cache.delete(cache.keys().next().value!);return mask;
}
