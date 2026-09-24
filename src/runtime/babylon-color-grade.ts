import type {TargetCamera,PostProcess} from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {Scene} from "./scene.js";

export function createColorGradeEffect(r:BabylonSceneContext):PostProcess {
  return new r.B.PostProcess("Camera / ColorGrade","sceneColorGrade",["redRow","greenRow","blueRow","midpoint","strength"],null,1,null,r.B.Texture.NEAREST_SAMPLINGMODE,r.engine,false);
}

export class BabylonColorGrade {
  private effect?:PostProcess;
  private camera?:TargetCamera;
  private attached=false;
  constructor(private readonly renderer:BabylonSceneContext){}
  update(scene:Scene,camera:TargetCamera):void {
    if(this.camera!==camera){this.detach();this.camera=camera;}
    const c=scene.component(scene.cameraNode.id,"ColorGrade"),active=!!c?.enabled&&c.strength>0;
    if(active){
      this.effect??=createColorGradeEffect(this.renderer);
      const m=c.matrix,strength=c.strength;
      this.effect.onApply=e=>{
        e.setFloat4("redRow",m[0],m[1],m[2],m[3]);
        e.setFloat4("greenRow",m[4],m[5],m[6],m[7]);
        e.setFloat4("blueRow",m[8],m[9],m[10],m[11]);e.setFloat("strength",strength);
        e.setFloat3("midpoint",c.midpoint.r,c.midpoint.g,c.midpoint.b);
      };
    }
    if(active===this.attached)return;
    if(active)camera.attachPostProcess(this.effect!);else this.detach();
    this.attached=active;
  }
  private detach():void {if(this.attached&&this.effect)this.camera?.detachPostProcess(this.effect);this.attached=false;}
  dispose():void {this.detach();this.effect?.dispose();this.effect=undefined;this.camera=undefined;}
}
