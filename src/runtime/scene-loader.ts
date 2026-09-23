import type {LoadingProgress} from "./loading-status.js";

/** Native download progress and JSON decoding, before any scene assets exist. */
export async function loadSceneJSON(url:URL,progress:LoadingProgress,signal:AbortSignal):Promise<{data:unknown;baseURL:string}> {
  const name=url.protocol==="data:"?"Inline scene":url.pathname.split("/").at(-1)||"Scene";
  const finish=progress.begin("Scene",`${name} — connecting…`),request=new XMLHttpRequest();
  const abort=()=>request.abort();
  try {
    signal.throwIfAborted();
    return await new Promise((resolve,reject)=>{
      request.open("GET",url.href);request.responseType="json";
      let lastReport=-Infinity;
      request.onprogress=event=>{
        const now=performance.now(),known=event.lengthComputable&&event.total>0&&event.loaded<=event.total;
        if(now-lastReport<100&&!(known&&event.loaded===event.total))return;lastReport=now;
        const size=`${(event.loaded/1024).toFixed(1)} KiB`;
        finish.update(known?`${name} — ${size} / ${(event.total/1024).toFixed(1)} KiB (${Math.floor(event.loaded/event.total*100)}%)`:`${name} — ${size} received`);
      };
      request.onload=()=>{
        if(request.status<200||request.status>=300){reject(new Error(`Could not load scene (${request.status}): ${url}`));return;}
        const data:unknown=request.response;
        if(data===null){reject(new Error(`Could not parse scene JSON: ${url}`));return;}
        finish.update(name);resolve({data,baseURL:request.responseURL||url.href});
      };
      request.onerror=()=>reject(new Error(`Could not download scene: ${url}`));
      request.onabort=()=>reject(signal.reason??new DOMException("Scene download cancelled.","AbortError"));
      signal.addEventListener("abort",abort,{once:true});request.send();
    });
  }finally{signal.removeEventListener("abort",abort);finish();}
}
