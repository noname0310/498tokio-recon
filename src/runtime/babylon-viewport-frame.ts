import type {TargetCamera,PostProcess,Mesh,ShaderMaterial} from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {Scene} from "./scene.js";
import type {View} from "./types.js";
import {viewportFrameLayout} from "./viewport-frame.js";

const uniforms=["viewportSize","aperture","radius","shadowOffset","borderColor","shadowColor","deviceScale"];
export function createViewportFrameEffect(r:BabylonSceneContext,camera:TargetCamera):PostProcess {
  return new r.B.PostProcess("Camera / ViewportFrame","sceneViewportFrame",uniforms,null,1,camera,r.B.Texture.NEAREST_SAMPLINGMODE,r.engine,false);
}
export function createViewportFramePlane(r:BabylonSceneContext):{mesh:Mesh;material:ShaderMaterial}{
  const material=new r.B.ShaderMaterial("Camera / depth frame",r.scene,{vertex:"sceneEntity",fragment:"sceneViewportFramePlane"},{attributes:["position","uv"],uniforms:["worldViewProjection",...uniforms],needAlphaBlending:true});
  material.backFaceCulling=false;material.disableDepthWrite=true;
  return {mesh:r.quad("Camera / depth frame",null,material),material};
}

export class BabylonViewportFrame {
  private effect?:PostProcess;
  private camera?:TargetCamera;
  private plane?:ReturnType<typeof createViewportFramePlane>;
  private geometryKey="";
  private key="";
  constructor(private readonly renderer:BabylonSceneContext){}
  update(scene:Scene,view:View,camera:TargetCamera):void {
    const c=scene.component(scene.cameraNode.id,"ViewportFrame");
    if(!c?.enabled){this.dispose();return;}
    if(c.depth!==null){
      if(this.effect){this.effect.dispose();this.effect=undefined;this.key="";}
      this.plane??=createViewportFramePlane(this.renderer);
      const r=this.renderer,{mesh,material}=this.plane,cam=scene.requireComponent(scene.cameraNode.id,"Camera"),scale=scene.frustumScale(c.depth),offset=scene.projectionOffset;
      mesh.parent=camera;mesh.position.set(-offset.x*scale,-offset.y*scale,c.depth);mesh.setEnabled(c.depth>=cam.near&&c.depth<=cam.far);
      const geometryKey=JSON.stringify([view.worldWidth,view.worldHeight,scale]);
      if(this.geometryKey!==geometryKey){this.geometryKey=geometryKey;r.rect(mesh,-view.worldWidth*scale/2,-view.worldHeight*scale/2,view.worldWidth*scale/2,view.worldHeight*scale/2);}
      const l=viewportFrameLayout(c,view),a=l.aperture,s=c.innerShadow,B=r.B;
      const key=JSON.stringify([l,c.color,s.color,s.opacity,view.dpr]);if(this.key===key)return;this.key=key;
      r.vec2(material,"viewportSize",{x:l.width,y:l.height});r.vec2(material,"shadowOffset",l.offset);
      material.setVector4("aperture",new B.Vector4(a.x,a.y,a.width,a.height));material.setFloat("radius",l.radius);material.setFloat("deviceScale",view.dpr);
      material.setVector4("borderColor",new B.Vector4(c.color.r,c.color.g,c.color.b,c.color.a));material.setVector4("shadowColor",new B.Vector4(s.color.r,s.color.g,s.color.b,s.color.a*s.opacity));
      return;
    }
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
  dispose():void {this.effect?.dispose();this.effect=undefined;this.plane?.mesh.dispose();this.plane?.material.dispose();this.plane=undefined;this.camera=undefined;this.key="";this.geometryKey="";}
}
