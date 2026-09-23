import type {PixelImage,TextureJob} from "./types.js";
import type {TextureRequest,TextureResponse} from "./texture-worker.js";
import {createTextureWorker} from "./create-texture-worker.js";

export interface TextureWorkerHandle {worker:Worker;dispose():void}
export type TextureWorkerFactory=()=>TextureWorkerHandle;

/** One persistent worker per resource lifetime; job failures do not kill its queue. */
export class TextureProcessor {
  private handle?:TextureWorkerHandle;private nextId=0;private disposed=false;
  private readonly pending=new Map<number,{resolve:(image:PixelImage)=>void;reject:(error:Error)=>void}>();
  constructor(private readonly factory:TextureWorkerFactory=createTextureWorker){}
  run(input:TextureJob):Promise<PixelImage> {
    if(this.disposed)return Promise.reject(new Error("Texture processor has been disposed."));
    return new Promise((resolve,reject)=>{
      if(!this.handle){
        const handle=this.handle=this.factory();
        handle.worker.onmessage=({data}:MessageEvent<TextureResponse>)=>{
          const job=this.pending.get(data.id);if(!job)return;this.pending.delete(data.id);
          if(data.error!==undefined)job.reject(new Error(data.error));else job.resolve(data.result);
        };
        handle.worker.onerror=event=>{event.preventDefault();this.fail(new Error(event.message||"Texture worker failed."));};
        handle.worker.onmessageerror=()=>this.fail(new Error("Could not decode a texture worker response."));
      }
      const id=this.nextId++;this.pending.set(id,{resolve,reject});
      try {this.handle.worker.postMessage({id,input} satisfies TextureRequest);}
      catch(error){this.pending.delete(id);reject(error);}
    });
  }
  private fail(error:Error):void {
    this.handle?.dispose();this.handle=undefined;
    for(const job of this.pending.values())job.reject(error);this.pending.clear();
  }
  dispose():void {this.disposed=true;this.fail(new Error("Texture job cancelled."));}
}
