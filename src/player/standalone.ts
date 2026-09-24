import {BabylonRenderer} from "../runtime/babylon.js";
import {startPlayer} from "../runtime/player-host.js";
import sceneData from "../../assets/final_animation.scene.json";
import soundtrack from "../../assets/soundtrack.m4a";
import {bundledAssets} from "./bundled-assets.js";

const base=new URL("./",document.baseURI);
void startPlayer({
  scene:sceneData,baseURL:new URL("assets/final_animation.scene.json",base).href,
  rendererLabel:"Babylon.js",createRenderer:viewport=>new BabylonRenderer(viewport),
  resolveAsset:bundledAssets(base,{"assets/soundtrack.m4a":soundtrack})
});
