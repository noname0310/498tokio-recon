import type {TargetCamera,PostProcess,RawTexture} from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {Scene} from "./scene.js";
import type {View} from "./types.js";
import {scanlinePhase,scanlineRows} from "./scanline-jitter.js";
import {cameraBlurSigma} from "./camera-motion-blur.js";

export function createScanlineJitterEffect(r:BabylonSceneContext):PostProcess {
  return new r.B.PostProcess("Camera / ScanlineJitter","sceneScanlineJitter",["rowCount","noiseRows","noisePhase","amplitude"],["noiseSampler"],1,null,r.B.Texture.BILINEAR_SAMPLINGMODE,r.engine,false);
}
export class BabylonScanlineJitter {
  private effect?:PostProcess;private camera?:TargetCamera;private attached=false;private index=0;
  private readonly textures=new Map<number,RawTexture>();private noise?:RawTexture;
  private phase={first:0,second:0,mix:0};private rows=0;private amplitude=0;
  constructor(private readonly renderer:BabylonSceneContext){}
  update(scene:Scene,view:View,camera:TargetCamera):void {
    if(this.camera!==camera){this.detach();this.camera=camera;}
    const c=scene.component(scene.cameraNode.id,"ScanlineJitter"),active=!!c?.enabled&&c.amplitudeWorld>0;
    if(!active){this.detach();return;}
    const r=this.renderer;
    let texture=this.textures.get(c.seed);
    if(!texture){texture=r.texture("Scanline noise",r.resources.scanline(c.seed),{repeatY:true});this.textures.set(c.seed,texture);}
    this.noise=texture;this.phase=scanlinePhase(c,scene.timelineTime);this.rows=view.worldHeight/c.lineHeightWorld;this.amplitude=2*c.amplitudeWorld/view.worldWidth;
    if(!this.effect){
      this.effect=createScanlineJitterEffect(r);
      this.effect.onApply=e=>{
        e.setTexture("noiseSampler",this.noise!);e.setFloat("noiseRows",scanlineRows);e.setFloat("rowCount",this.rows);
        e.setFloat3("noisePhase",this.phase.first,this.phase.second,this.phase.mix);e.setFloat("amplitude",this.amplitude);
      };
    }
    const blur=cameraBlurSigma(scene),index=Number(blur.x>0)+Number(blur.y>0);
    if(this.attached&&this.index!==index)this.detach();
    if(!this.attached){camera.attachPostProcess(this.effect,index);this.index=index;this.attached=true;}
  }
  private detach():void {if(this.attached&&this.effect)this.camera?.detachPostProcess(this.effect);this.attached=false;}
  dispose():void {this.detach();this.effect?.dispose();this.effect=undefined;for(const texture of this.textures.values())texture.dispose();this.textures.clear();this.camera=undefined;}
}
