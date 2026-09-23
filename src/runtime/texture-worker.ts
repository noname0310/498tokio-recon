import { generateTexture } from "./procedural.js";
import type { TextureJob, PixelImage } from "./types.js";

export interface TextureRequest {id:number;input:TextureJob}
export type TextureResponse={id:number}&({result:PixelImage;error?:never}|{error:string;result?:never});
interface TextureWorkerScope {
  onmessage:((event:MessageEvent<TextureRequest>)=>void)|null;
  postMessage(message:TextureResponse,transfer:Transferable[]):void;
}
const scope=self as unknown as TextureWorkerScope;
scope.onmessage=({data})=>{
  try {const result=generateTexture(data.input);scope.postMessage({id:data.id,result},[result.data.buffer as ArrayBuffer]);}
  catch(error){scope.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)},[]);}
};
