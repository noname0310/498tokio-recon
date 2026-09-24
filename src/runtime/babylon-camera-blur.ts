import type {TargetCamera,PostProcess} from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {Scene} from "./scene.js";
import type {View} from "./types.js";

/** One shared program for both axes; sampling is specified in screen UVs. */
export function createCameraBlurEffect(r:BabylonSceneContext):PostProcess {
  return new r.B.PostProcess("Camera / GaussianBlur","sceneCameraBlur",["blurStep"],null,1,null,r.B.Texture.BILINEAR_SAMPLINGMODE,r.engine,false);
}

export class BabylonCameraBlur {
  private readonly passes:(PostProcess|undefined)[]=[undefined,undefined];
  private readonly attached=[false,false];
  private camera?:TargetCamera;
  private x=0;private y=0;
  constructor(private readonly renderer:BabylonSceneContext){}
  update(scene:Scene,view:View,camera:TargetCamera):void {
    if(this.camera!==camera){
      this.detach();this.camera=camera;
    }
    const blur=scene.component(scene.cameraNode.id,"GaussianBlur");
    this.x=blur?.enabled?blur.sigmaWorld.x/view.worldWidth:0;
    this.y=blur?.enabled?blur.sigmaWorld.y/view.worldHeight:0;
    for(let axis=0;axis<2;axis++){
      const active=(axis===0?this.x:this.y)>0;
      if(active&&!this.passes[axis]){
        const pass=this.passes[axis]=createCameraBlurEffect(this.renderer);
        pass.onApply=e=>e.setFloat2("blurStep",axis===0?this.x:0,axis===1?this.y:0);
      }
      if(active===this.attached[axis])continue;
      const pass=this.passes[axis]!;
      // Camera blur precedes viewport masks and display overlays. Reuse the
      // passes when the measured shake reaches zero; no sharp-frame GPU pass.
      if(active)camera.attachPostProcess(pass,axis===0?0:(this.attached[0]?1:0));
      else camera.detachPostProcess(pass);
      this.attached[axis]=active;
    }
  }
  private detach():void {
    for(let i=0;i<2;i++){
      if(this.attached[i]&&this.passes[i])this.camera?.detachPostProcess(this.passes[i]!);
      this.attached[i]=false;
    }
  }
  dispose():void {this.detach();for(const pass of this.passes)pass?.dispose();this.passes.fill(undefined);this.camera=undefined;}
}
