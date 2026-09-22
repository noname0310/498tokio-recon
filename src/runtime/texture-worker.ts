import { generateTexture } from "./procedural.js";
import type { TextureJob, PixelImage } from "./types.js";

export type TextureResponse={result:PixelImage;error?:never}|{error:string;result?:never};
interface TextureWorkerScope {
  onmessage:((event:MessageEvent<TextureJob>)=>void)|null;
  postMessage(message:TextureResponse,transfer:Transferable[]):void;
}
const scope=self as unknown as TextureWorkerScope;
scope.onmessage=({data})=>{
  try {const result=generateTexture(data);scope.postMessage({result},[result.data.buffer as ArrayBuffer]);}
  catch(error){scope.postMessage({error:error instanceof Error?error.message:String(error)},[]);}
};
