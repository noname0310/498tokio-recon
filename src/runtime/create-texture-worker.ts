import type {TextureWorkerHandle} from "./texture-processor.js";

export function createTextureWorker():TextureWorkerHandle {
  const worker=new Worker(new URL("./texture-worker.ts",import.meta.url),{type:"module"});
  return {worker,dispose:()=>worker.terminate()};
}
