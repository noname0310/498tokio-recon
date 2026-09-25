import type * as Babylon from "@babylonjs/core/pure";
import type {BabylonSceneContext} from "./babylon-context.js";
import type {FadeTransition} from "./types.js";

/** Capture only while a fade is partial; full opacity uses normal scene draws. */
export class BabylonFade {
  readonly mesh:Babylon.Mesh;
  readonly material:Babylon.ShaderMaterial;
  private texture?:Babylon.RenderTargetTexture;
  constructor(private readonly renderer:BabylonSceneContext,id:string){
    const r=renderer,B=r.B;
    B.Effect.ShadersStore.sceneFadeVertexShader=`precision highp float;attribute vec3 position;attribute vec2 uv;varying vec2 texUV;void main(){texUV=uv;gl_Position=vec4(position.xy*2.0,0.0,1.0);}`;
    B.Effect.ShadersStore.sceneFadeFragmentShader=`precision highp float;varying vec2 texUV;uniform sampler2D image;uniform float opacity;void main(){vec4 c=texture2D(image,texUV);gl_FragColor=vec4(c.rgb/max(c.a,.000001),c.a*opacity);}`;
    this.material=new B.ShaderMaterial(`${id}/fade`,r.scene,{vertex:"sceneFade",fragment:"sceneFade"},{attributes:["position","uv"],uniforms:["opacity"],samplers:["image"],needAlphaBlending:true});
    this.material.setTexture("image",r.neutralTexture);this.material.setFloat("opacity",1);
    this.material.backFaceCulling=false;this.material.disableDepthWrite=true;this.material.depthFunction=B.Engine.ALWAYS;
    this.mesh=r.quad(`${id}/composite`,null,this.material);this.mesh.setEnabled(false);
  }
  capture(members:Babylon.AbstractMesh[],opacity:number,composition:FadeTransition["composition"]="source-over"):void {
    const r=this.renderer,B=r.B,size={width:r.engine.getRenderWidth(),height:r.engine.getRenderHeight()};
    if(!this.texture){
      this.texture=new B.RenderTargetTexture(this.mesh.name,size,r.scene,{generateMipMaps:false,generateDepthBuffer:true,generateStencilBuffer:true,samplingMode:B.Texture.NEAREST_SAMPLINGMODE,gammaSpace:false});
      this.texture.clearColor=new B.Color4(0,0,0,0);this.texture.renderParticles=false;this.texture.renderSprites=false;
      this.texture.wrapU=this.texture.wrapV=B.Texture.CLAMP_ADDRESSMODE;
      this.material.setTexture("image",this.texture);
    }else if(this.texture.getRenderWidth()!==size.width||this.texture.getRenderHeight()!==size.height)this.texture.resize(size);
    this.texture.activeCamera=r.scene.activeCamera;this.texture.renderList=members;
    // Straight-RGB shader outputs need SRC_ALPHA/ONE for RGB and ONE/ONE
    // for alpha. Scope the blend state to this capture and restore all shared
    // materials, so ordinary scene draws and later seeks keep their own mode.
    const additive=composition==="plus-lighter",materials=[...new Set(members.map(m=>m.material).filter((m):m is Babylon.Material=>m!==null))];
    const restore=materials.map(material=>{
      const mode=material.alphaMode;
      // ALPHA_COMBINE adds source/destination alpha. A transparent capture
      // instead needs Porter-Duff alpha, including partially overlapping art.
      material.alphaMode=additive?B.Engine.ALPHA_ADD:mode===B.Engine.ALPHA_COMBINE?B.Constants.ALPHA_LAYER_ACCUMULATE:mode;
      const observer=additive?material.onBindObservable.add(()=>r.engine.alphaState.setAlphaBlendFunctionParameters(0x0302,1,1,1)):null;
      return ()=>{if(observer)material.onBindObservable.remove(observer);material.alphaMode=mode;};
    });
    try{this.texture.render(false);}
    finally{for(const reset of restore)reset();r.engine.setAlphaMode(B.Engine.ALPHA_DISABLE,true);}
    this.material.setFloat("opacity",opacity);this.mesh.setEnabled(true);
  }
  release():void {this.mesh.setEnabled(false);if(this.texture){this.material.setTexture("image",this.renderer.neutralTexture);this.texture.dispose();this.texture=undefined;}}
  dispose():void {this.release();this.mesh.dispose();this.material.dispose();}
}
