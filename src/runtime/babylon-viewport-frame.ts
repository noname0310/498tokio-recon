import type {TargetCamera,PostProcess} from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {Scene} from "./scene.js";
import type {View} from "./types.js";
import {viewportFrameLayout} from "./viewport-frame.js";

export function createViewportFrameEffect(r:BabylonSceneContext,camera:TargetCamera):PostProcess {
  return new r.B.PostProcess("Camera / ViewportFrame","sceneViewportFrame",["viewportSize","aperture","radius","shadowOffset","borderColor","shadowColor","deviceScale"],null,1,camera,r.B.Texture.NEAREST_SAMPLINGMODE,r.engine,false);
}

export class BabylonViewportFrame {
  private effect?:PostProcess;
  private camera?:TargetCamera;
  private key="";
  constructor(private readonly renderer:BabylonSceneContext){}
  update(scene:Scene,view:View,camera:TargetCamera):void {
    const c=scene.component(scene.cameraNode.id,"ViewportFrame");
    if(!c?.enabled){this.dispose();return;}
    if(!this.effect||this.camera!==camera){
      this.dispose();this.camera=camera;
      this.effect=createViewportFrameEffect(this.renderer,camera);
    }
    const l=viewportFrameLayout(c,view),a=l.aperture,shadow=c.innerShadow;
    const key=JSON.stringify([l,c.color,shadow.color,shadow.opacity,view.dpr]);
    if(this.key===key)return;this.key=key;
    this.effect.onApply=e=>{
      e.setFloat2("viewportSize",l.width,l.height);e.setFloat4("aperture",a.x,a.y,a.width,a.height);e.setFloat("radius",l.radius);
      e.setFloat2("shadowOffset",l.offset.x,l.offset.y);e.setFloat4("borderColor",c.color.r,c.color.g,c.color.b,c.color.a);
      e.setFloat4("shadowColor",shadow.color.r,shadow.color.g,shadow.color.b,shadow.color.a*shadow.opacity);e.setFloat("deviceScale",view.dpr);
    };
  }
  dispose():void {this.effect?.dispose();this.effect=undefined;this.camera=undefined;this.key="";}
}
