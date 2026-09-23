import {Engine} from "./engine.js";
import {Time} from "./animation/time.js";
import type {Renderer} from "./types.js";

interface InitializationOptions {
  viewport:HTMLElement;renderer:Renderer;scene:unknown;baseURL?:string;controls?:boolean;
  resolveAsset?:(url:string)=>string;onError?:(error:unknown)=>void;
}
interface PlayerHostOptions {
  scene:unknown;baseURL?:string;rendererLabel:string;
  createRenderer:(viewport:HTMLElement)=>Renderer|Promise<Renderer>;
  resolveAsset?:(url:string)=>string;
}

declare global {interface Window {scenePlayer?:Engine}}

/** Subscribe before loadScene starts progressive resource preparation. */
export async function initializePlayer({scene,baseURL,onError,...options}:InitializationOptions):Promise<Engine> {
  let engine:Engine|undefined;
  try {
    engine=new Engine(options);
    if(onError)engine.onError(onError);
    await engine.loadScene(scene,{baseURL});
    return engine;
  }catch(error){
    if(engine)engine.dispose();else options.renderer.dispose();
    throw error;
  }
}

/** Shared browser lifecycle; the entry supplies its assets and renderer factory. */
export async function startPlayer({scene,baseURL,rendererLabel,createRenderer,resolveAsset}:PlayerHostOptions):Promise<void> {
  const status=document.getElementById("status"),viewport=document.getElementById("viewport");
  const showError=(error:unknown)=>{
    if(status){
      status.textContent=`Could not display the scene: ${error instanceof Error?error.message:String(error)}`;
      status.setAttribute("role","alert");status.hidden=false;
    }
    console.error(error);
  };
  let engine:Engine|undefined;
  try {
    if(!status||!viewport)throw new Error("The player requires status and viewport elements.");
    if(!scene)throw new Error("Provide a scene URL using ?scene=path/to/scene.json.");
    const query=new URLSearchParams(location.search),started=performance.now();
    const renderer=await createRenderer(viewport);
    // Hand off once. A later resource error must survive successful startup.
    status.hidden=true;
    engine=await initializePlayer({viewport,renderer,scene,baseURL,controls:query.get("controls")!=="0",resolveAsset,onError:showError});
    if(query.has("frame")){engine.pause();await engine.seekFrame(Time.fromDecimal(Number(query.get("frame"))));}
    else if(query.has("time")){engine.pause();await engine.seek(Number(query.get("time")));}
    engine.generationMs=performance.now()-started;
    window.scenePlayer=engine;
    document.title=`${engine.scene.data.name||"Scene"} · ${rendererLabel}`;
    const player=engine;window.addEventListener("pagehide",()=>player.dispose(),{once:true});
  }catch(error){engine?.dispose();showError(error);}
}
