import type * as Babylon from "@babylonjs/core/pure";
import {B} from "./babylon-library.js";
import type {Scene} from "./scene.js";
import type {Resources} from "./resources.js";
import type {Color,Entity,PixelImage,RenderObject,Vec2} from "./types.js";

export interface TextureOptions {linear?:boolean;repeatX?:boolean;repeatY?:boolean}
export interface BabylonRenderObject extends RenderObject {prepareShaders?():void}
export type BabylonObjectConstructor=new(context:BabylonSceneContext,node:Entity)=>BabylonRenderObject;

/** Material/mesh factories shared by live rendering and isolated preparation.
 * Both scenes use the same engine and therefore the same compiled effects. */
export class BabylonSceneContext {
  readonly B=B;
  readonly scene:Babylon.Scene;
  readonly nodes=new Map<string,Babylon.TransformNode|Babylon.TargetCamera>();
  readonly entityOwners=new WeakMap<Babylon.AbstractMesh,string>();
  readonly neutralTexture:Babylon.RawTexture;
  constructor(readonly engine:Babylon.Engine,readonly data:Scene,readonly resources:Resources,readonly render:()=>void){
    this.scene=new B.Scene(engine);this.scene.clearColor=new B.Color4(0,0,0,1);
    this.neutralTexture=this.texture("neutral",{width:1,height:1,channels:4,data:new Uint8Array([128,128,128,255])});
  }
  texture(name:string,asset:PixelImage,{linear=false,repeatX=false,repeatY=false}:TextureOptions={}){
    const B=this.B,rgba=new Uint8Array(asset.width*asset.height*4);
    for(let i=0;i<asset.width*asset.height;i++){const a=i*asset.channels,b=i*4;rgba[b]=asset.data[a];rgba[b+1]=asset.data[a+(asset.channels===1?0:1)];rgba[b+2]=asset.data[a+(asset.channels===1?0:2)];rgba[b+3]=asset.channels===4?asset.data[a+3]:255;}
    const t=B.RawTexture.CreateRGBATexture(rgba,asset.width,asset.height,this.scene,false,false,linear?B.Texture.BILINEAR_SAMPLINGMODE:B.Texture.NEAREST_SAMPLINGMODE);t.name=name;t.gammaSpace=false;t.wrapU=repeatX?B.Texture.WRAP_ADDRESSMODE:B.Texture.CLAMP_ADDRESSMODE;t.wrapV=repeatY?B.Texture.WRAP_ADDRESSMODE:B.Texture.CLAMP_ADDRESSMODE;return t;
  }
  spriteMaterial(name:string,mask:boolean,additive:boolean){
    const B=this.B,m=new B.ShaderMaterial(name,this.scene,{vertex:"sceneEntity",fragment:"sceneSprite"},{attributes:["position","uv"],uniforms:["worldViewProjection","tint","maskOnly","intensity","hue","saturation","brightness","contrast","whiteMix","motionArt","motionEnabled","motionAmount","motionCount","motionCenter","motionOffset","motionGain","filterPadding","filterFrame","filterCell","filterGrid","uvRect","uvBounds","noiseOrigin","noiseSize","noiseRange","noiseEnabled","noiseChannelGain","opacityGradientEnabled","opacityGradientStart","opacityGradientEnd","secondaryOrigin","secondarySize","secondaryOpacity","alphaCutoff","focusEnabled","focusDistance","focusEye","focusLensX","focusLensY","focusDepth","focusLimit"],samplers:["spriteTex","noiseTex","filteredTex","secondaryTex"],needAlphaBlending:true});
    m.setVector4("uvRect",new B.Vector4(0,0,1,1));m.setVector4("uvBounds",new B.Vector4(0,0,1,1));m.setFloat("saturation",1);m.setFloat("brightness",1);m.setFloat("contrast",1);m.setFloat("whiteMix",0);m.setFloat("motionEnabled",0);m.setFloat("motionAmount",0);m.setInt("motionCount",25);m.setVector4("motionArt",new B.Vector4(0,0,1,1));this.vec2(m,"motionCenter",{x:0,y:0});this.vec2(m,"motionOffset",{x:0,y:0});
    this.vec2(m,"noiseOrigin",{x:0,y:0});this.vec2(m,"noiseSize",{x:1,y:1});m.setFloat("noiseRange",0);m.setFloat("noiseEnabled",0);m.setTexture("noiseTex",this.neutralTexture);
    m.setVector3("noiseChannelGain",new B.Vector3(1,1,1));
    m.setTexture("filteredTex",this.neutralTexture);m.setFloat("filterPadding",0);m.setFloat("filterFrame",0);m.setFloat("motionGain",1);this.vec2(m,"filterCell",{x:1,y:1});this.vec2(m,"filterGrid",{x:1,y:1});
    m.setTexture("secondaryTex",this.neutralTexture);m.setFloat("secondaryOpacity",0);this.vec2(m,"secondaryOrigin",{x:0,y:0});this.vec2(m,"secondarySize",{x:1,y:1});
    m.setFloat("opacityGradientEnabled",0);this.vec2(m,"opacityGradientStart",{x:0,y:0});this.vec2(m,"opacityGradientEnd",{x:0,y:-1});
    m.setFloat("alphaCutoff",0);m.setFloat("focusEnabled",0);m.setFloat("focusDistance",1);
    this.vec2(m,"focusLimit",{x:0,y:.32});
    for(const key of ["focusEye","focusLensX","focusLensY","focusDepth"])m.setVector3(key,new B.Vector3(0,0,0));
    m.backFaceCulling=false;m.disableDepthWrite=true;m.alphaMode=additive?B.Engine.ALPHA_ADD:B.Engine.ALPHA_COMBINE;m.setFloat("maskOnly",mask?1:0);m.setFloat("intensity",1);m.setFloat("hue",0);m.setTexture("spriteTex",this.neutralTexture);return m;
  }
  quad(name:string,id:string|null,material:Babylon.Material,owner=id){const mesh=this.B.CreatePlane(name,{size:1,updatable:true},this.scene);mesh.parent=id?this.nodes.get(id)||null:null;mesh.material=material;mesh.alwaysSelectAsActiveMesh=true;if(owner)this.entityOwners.set(mesh,owner);return mesh;}
  rect(mesh:Babylon.Mesh,left:number,bottom:number,right:number,top:number){mesh.updateVerticesData(this.B.VertexBuffer.PositionKind,[left,bottom,0,right,bottom,0,right,top,0,left,top,0]);mesh.refreshBoundingInfo();}
  vec2(material:Babylon.ShaderMaterial,name:string,value:Vec2){material.setVector2(name,new this.B.Vector2(value.x,value.y));}
  tint(material:Babylon.ShaderMaterial,c:Color,opacity=1){material.setVector4("tint",new this.B.Vector4(c.r,c.g,c.b,c.a*opacity));}
  vignetteEffect(camera:Babylon.TargetCamera):Babylon.PostProcess {
    const effect=new B.PostProcess("Camera / Vignette","sceneVignette",["center","shape","enabled"],null,1,camera,B.Texture.NEAREST_SAMPLINGMODE,this.engine,false);
    effect.onApply=e=>{const v=this.data.component(this.data.cameraNode.id,"Vignette");e.setFloat2("center",v?.centerViewport.x||0,v?.centerViewport.y||0);e.setFloat3("shape",v?.quadratic||0,v?.quartic||0,v?.verticalWeight||1);e.setFloat("enabled",v?.enabled&&v.depth===null?1:0);};
    return effect;
  }
  depthVignetteMaterial():Babylon.ShaderMaterial {
    const material=new B.ShaderMaterial("Camera / depth vignette",this.scene,{vertex:"sceneEntity",fragment:"sceneVignettePlane"},{attributes:["position","uv"],uniforms:["worldViewProjection","halfSize","center","shape"],needAlphaBlending:true});
    material.backFaceCulling=false;material.disableDepthWrite=true;return material;
  }
  dispose():void {this.scene.dispose();this.nodes.clear();}
}
