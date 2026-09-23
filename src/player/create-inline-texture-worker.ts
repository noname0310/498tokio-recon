import TextureWorker from "../runtime/texture-worker.ts?inline-worker";
import type {TextureWorkerHandle} from "../runtime/texture-processor.js";

export function createTextureWorker():TextureWorkerHandle {
  const worker=new TextureWorker();
  return {worker,dispose:()=>worker.terminate()};
}
