import {Math3D as M} from "./math.js";
import type {Scene} from "./scene.js";
import type {Vec2} from "./types.js";

/** Axis exposure variance in reference-plane units. The finite focus distance
 * is explicit because a screen filter cannot reproduce per-pixel depth blur. */
export function cameraBlurSigma(scene:Scene):Vec2 {
  const id=scene.cameraNode.id,blur=scene.component(id,"GaussianBlur"),motion=scene.component(id,"CameraMotionBlur");
  let vx=blur?.enabled?blur.sigmaWorld.x**2:0,vy=blur?.enabled?blur.sigmaWorld.y**2:0;
  if(motion?.enabled&&motion.shutterSeconds>0&&motion.maxSigmaWorld>0){
    const world=scene.world.get(id)!,focus=M.point(world,{x:0,y:0,z:motion.focusDistance});
    const samples=5;let sx=0,sy=0,xx=0,yy=0;
    for(let i=0;i<samples;i++){
      const time=Math.max(0,scene.time+(i/(samples-1)-.5)*motion.shutterSeconds);
      const p=M.point(M.inverse(scene.matrixAt(id,time)),focus),s=scene.frustumScale(Math.max(p.z,scene.requireComponent(id,"Camera").near));
      const x=p.x/s,y=p.y/s;sx+=x;sy+=y;xx+=x*x;yy+=y*y;
    }
    vx+=Math.min(motion.maxSigmaWorld**2,Math.max(0,xx/samples-(sx/samples)**2));
    vy+=Math.min(motion.maxSigmaWorld**2,Math.max(0,yy/samples-(sy/samples)**2));
  }
  return {x:Math.sqrt(vx),y:Math.sqrt(vy)};
}
