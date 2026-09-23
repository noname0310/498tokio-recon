import {initializePlayer,startPlayer} from "./player-host.js";
import type {Renderer} from "./types.js";

export type RendererName="dom"|"babylon";
export interface PlayerOptions {
  viewport:HTMLElement;sceneURL:string;renderer?:RendererName|Renderer;controls?:boolean;
  resolveAsset?:(url:string)=>string;onError?:(error:unknown)=>void;
}

export async function createPlayer({viewport,sceneURL,renderer="dom",...options}:PlayerOptions){
  const backend=typeof renderer==="string"?await createRenderer(viewport,renderer):renderer;
  return initializePlayer({viewport,scene:sceneURL,renderer:backend,...options});
}

export async function createRenderer(viewport:HTMLElement,renderer:RendererName="dom"):Promise<Renderer>{
  if(renderer==="dom"){
    const {DOMRenderer}=await import(/* webpackChunkName: "dom-backend" */ "./dom.js");
    return new DOMRenderer(viewport);
  }
  if(renderer==="babylon"){
    const {BabylonRenderer}=await import(/* webpackChunkName: "babylon-backend" */ "./babylon.js");
    return new BabylonRenderer(viewport);
  }
  throw new Error(`Unknown renderer: ${renderer}`);
}

export function boot({resolveAsset}:{resolveAsset?:(url:string)=>string}={}):Promise<void>{
  const query=new URLSearchParams(location.search);
  const scene=query.get("scene")||document.documentElement.dataset.scene;
  const renderer=query.get("renderer")||document.documentElement.dataset.renderer||"dom";
  return startPlayer({scene,rendererLabel:renderer==="dom"?"DOM":"Babylon.js",resolveAsset,createRenderer:viewport=>{
    if(renderer!=="dom"&&renderer!=="babylon")throw new Error(`Unknown renderer: ${renderer}`);
    return createRenderer(viewport,renderer);
  }});
}
