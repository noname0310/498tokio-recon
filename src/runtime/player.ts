import { Engine } from "./engine.js";
import { Time } from "./animation/time.js";
import type { Renderer } from "./types.js";
export type RendererName="dom"|"babylon";
export interface PlayerOptions {viewport:HTMLElement;sceneURL:string;renderer?:RendererName;controls?:boolean}
declare global {interface Window {scenePlayer?:Engine}}
const errorMessage=(error:unknown)=>error instanceof Error?error.message:String(error);


export async function createPlayer({viewport,sceneURL,renderer="dom",controls=true}:PlayerOptions){
  const backend=await createRenderer(viewport,renderer);
  const engine=new Engine({viewport,renderer:backend,controls});
  try{await engine.loadScene(sceneURL);return engine;}catch(error){engine.dispose();throw error;}
}
export async function createRenderer(viewport:HTMLElement,renderer:RendererName="dom"):Promise<Renderer>{
  let backend:Renderer;
  if(renderer==="dom"){
    const {DOMRenderer}=await import(/* webpackChunkName: "dom-backend" */ "./dom.js");backend=new DOMRenderer(viewport);
  }else if(renderer==="babylon"){
    const {BabylonRenderer}=await import(/* webpackChunkName: "babylon-backend" */ "./babylon.js");backend=new BabylonRenderer(viewport);
  }else throw new Error(`Unknown renderer: ${renderer}`);
  return backend;
}

export async function boot(){
  const status=document.getElementById("status"),viewport=document.getElementById("viewport"),query=new URLSearchParams(location.search);
  if(!status||!viewport)throw new Error("The player requires status and viewport elements.");
  const sceneURL=query.get("scene")||document.documentElement.dataset.scene,renderer=query.get("renderer")||document.documentElement.dataset.renderer||"dom";
  const showError=(error:unknown)=>{status.hidden=false;status.textContent=`Could not display the scene: ${errorMessage(error)}`;status.setAttribute("role","alert");console.error(error);};
  if(!sceneURL){status.textContent="Provide a scene URL using ?scene=path/to/scene.json&renderer=dom or babylon.";return;}
  if(renderer!=="dom"&&renderer!=="babylon"){showError(new Error(`Unknown renderer: ${renderer}`));return;}
  try{
    const started=performance.now();const engine=await createPlayer({viewport,sceneURL,renderer,controls:query.get("controls")!=="0"});
    engine.generationMs=performance.now()-started;engine.onError(showError);
    if(query.has("frame")){engine.pause();await engine.seekFrame(Time.fromDecimal(Number(query.get("frame"))));}
    else if(query.has("time")){engine.pause();await engine.seek(Number(query.get("time")));}
    window.scenePlayer=engine;status.hidden=true;
    document.title=`${engine.scene.data.name||"Scene"} · ${renderer==="dom"?"DOM":"Babylon.js"}`;
    window.addEventListener("pagehide",()=>engine.dispose(),{once:true});
  }catch(error){showError(error);}
}
