import {BabylonNumber} from "./babylon-number.js";
import type * as Babylon from "@babylonjs/core/pure";
import { B, registerBabylon } from "./babylon-library.js";
import type { Scene } from "./scene.js";
import type { Resources } from "./resources.js";
import type { Entity, ComponentType, Component, Color, Vec2, Vec3, PixelImage, View, RenderObject, TextureJob, MaskParameters } from "./types.js";
export interface TextureOptions {linear?:boolean;repeatX?:boolean;repeatY?:boolean}

import { Math3D as M } from "./math.js";
import {BabylonPlane,BabylonLine} from "./babylon-geometry.js";
import { installShaders } from "./babylon-shaders.js";
import { BabylonParticles,orderParticleDraws } from "./babylon-particles.js";
import {BabylonTransitions} from "./babylon-transitions.js";
import {BabylonViewportFrame} from "./babylon-viewport-frame.js";
import {transitionGroups} from "./transitions.js";
import {clippedBounds} from "./geometry.js";
import {motionBounds} from "./sprite-motion-blur.js";
import {BabylonParticleFilter} from "./babylon-particle-filter.js";
const enabled=<T extends {enabled:boolean}>(c:T|undefined):c is T=>Boolean(c?.enabled);

class Sprite {
  private filter?:BabylonParticleFilter;
  readonly renderer:BabylonRenderer;readonly id:string;
  readonly textures:Map<string,Babylon.RawTexture>;readonly keys:Map<string,string>;readonly jobs:Map<string,Promise<void>>;readonly revisions:Map<string,number>;
  updateRevision=0;disposed=false;
  readonly meshes:Map<string,{mesh:Babylon.Mesh;material:Babylon.ShaderMaterial}>;
  constructor(renderer:BabylonRenderer,node:Entity){
    this.renderer=renderer;this.id=node.id;this.meshes=new Map();this.textures=new Map();this.keys=new Map();this.jobs=new Map();this.revisions=new Map();
    for(const [type,mask,additive] of [["DropShadow",true,false],["Glow",true,true],["SpriteRenderer",false,false]] as const){
      if(!node.components.some(c=>c.type===type))continue;
      const material=renderer.spriteMaterial(`${node.name} / ${type}`,mask,additive),mesh=renderer.quad(`${node.name} / ${type}`,node.id,material);
      this.meshes.set(type,{mesh,material});
    }
  }
  async update(scene:Scene){
    const r=this.renderer,B=r.B,sprite=scene.requireComponent(this.id,"SpriteRenderer"),asset=scene.asset(sprite.asset),resolution=scene.data.rendering.texturePixelsPerUnit;
    const state=scene.spriteState(this.id);
    const revision=this.updateRevision=(this.updateRevision||0)+1;
    if(!scene.active.get(this.id)||!state.visible){for(const {mesh}of this.meshes.values())mesh.setEnabled(false);return;}
    const source=await r.resources.image(scene,sprite.asset);if(this.disposed||revision!==this.updateRevision)return;
    const body=this.meshes.get("SpriteRenderer")!,width=state.size.x/asset.pixelsPerUnit,height=state.size.y/asset.pixelsPerUnit;
    const sourceKey=JSON.stringify([scene.source(sprite.asset),asset.filter]);
    if(this.keys.get("source")!==sourceKey){this.keys.set("source",sourceKey);this.textures.get("source")?.dispose();const texture=r.texture(`${this.id}/source`,source,{linear:asset.filter==="linear"});this.textures.set("source",texture);body.material.setTexture("spriteTex",texture);}
    const motion=scene.component(this.id,"SpriteMotionBlur"),moving=motion?.enabled&&(motion.radialAmount>0||motion.translationWorld.x!==0||motion.translationWorld.y!==0);
    const dilation=motion?.enabled?motion.dilationPixels:0,softness=motion?.enabled?motion.softnessPixels:0,filtered=dilation>0||softness>0;
    if(filtered){this.filter??=new BabylonParticleFilter(r,this.id);await this.filter.update(asset,this.textures.get("source")!,dilation,softness);if(this.disposed||revision!==this.updateRevision)return;}
    body.material.setTexture("filteredTex",filtered?this.filter!.texture!:r.neutralTexture);body.material.setFloat("filterPadding",filtered?Math.ceil(dilation+4*softness)+1:0);
    r.vec2(body.material,"filterCell",state.size);r.vec2(body.material,"filterGrid",{x:asset.atlas?.columns??1,y:asset.atlas?.rows??1});body.material.setFloat("filterFrame",state.frame);body.material.setFloat("motionGain",motion?.enabled?motion.alphaGain:1);
    const art={left:-asset.pivot.x*width,right:(1-asset.pivot.x)*width,bottom:-asset.pivot.y*height,top:(1-asset.pivot.y)*height},b=motion?.enabled?motionBounds(art,motion,asset.pixelsPerUnit):art;
    r.rect(body.mesh,b.left,b.bottom,b.right,b.top);body.material.setVector4("motionArt",new B.Vector4(art.left,art.bottom,width,height));body.material.setFloat("motionEnabled",moving?1:0);body.material.setFloat("motionAmount",motion?.radialAmount??0);body.material.setInt("motionCount",motion?.samples??25);r.vec2(body.material,"motionCenter",motion?.center??{x:0,y:0});r.vec2(body.material,"motionOffset",motion?.translationWorld??{x:0,y:0});
    body.mesh.setEnabled(state.visible);r.tint(body.material,sprite.color);body.material.setFloat("hue",sprite.hueDegrees*Math.PI/180);
    body.material.setFloat("saturation",sprite.saturation);body.material.setFloat("brightness",sprite.brightness);body.material.setFloat("whiteMix",sprite.whiteMix);
    const gradient=scene.component(this.id,"OpacityGradient");body.material.setFloat("opacityGradientEnabled",gradient?.enabled?1:0);r.vec2(body.material,"opacityGradientStart",gradient?.start??{x:0,y:0});r.vec2(body.material,"opacityGradientEnd",gradient?.end??{x:0,y:-1});
    const rect=state.rect;body.material.setVector4("uvRect",new B.Vector4(rect.x/source.width,rect.y/source.height,rect.width/source.width,rect.height/source.height));
    body.material.setVector4("uvBounds",asset.atlas?new B.Vector4((rect.x+.5)/source.width,(rect.y+.5)/source.height,(rect.x+rect.width-.5)/source.width,(rect.y+rect.height-.5)/source.height):new B.Vector4(0,0,1,1));
    const maskSource=asset.atlas?r.resources.crop(source,rect):source;
    const jobs:(Promise<void>|undefined)[]=[];
    const noise=scene.component(this.id,"ProceduralNoise");
    r.vec2(body.material,"noiseOrigin",noise?.origin||{x:0,y:0});r.vec2(body.material,"noiseSize",noise?.worldSize||{x:1,y:1});
    body.material.setFloat("noiseRange",noise?.range||0);body.material.setFloat("noiseEnabled",enabled(noise)&&noise.bands.some(b=>b.variance>0)?1:0);
    body.material.setVector3("noiseChannelGain",new B.Vector3(noise?.channelGain.r??1,noise?.channelGain.g??1,noise?.channelGain.b??1));
    if(noise){
      const key=r.resources.noiseKey(noise);
      if(this.keys.get("noise")!==key){
        this.keys.set("noise",key);const revision=(this.revisions.get("noise")||0)+1;this.revisions.set("noise",revision);
        this.jobs.set("noise",r.resources.noise(noise).then(result=>{
          if(this.disposed||this.revisions.get("noise")!==revision)return;
          this.textures.get("noise")?.dispose();const texture=r.texture(`${this.id}/noise`,result,{repeatX:true,repeatY:true});
          this.textures.set("noise",texture);body.material.setTexture("noiseTex",texture);
        }));
      }
      jobs.push(this.jobs.get("noise"));
    }
    for(const type of ["DropShadow","Glow"] as const){
      const c=scene.component(this.id,type),entry=this.meshes.get(type);if(!entry)continue;entry.mesh.setEnabled(state.visible&&enabled(c));
      if(!c)continue;
      const isShadow=c.type==="DropShadow";
      entry.material.alphaMode=!isShadow&&c.blend==="additive"?B.Engine.ALPHA_ADD:B.Engine.ALPHA_COMBINE;
      entry.mesh.position.set(isShadow?c.offsetWorld.x:0,isShadow?c.offsetWorld.y:0,isShadow?.0002:.0001);
      r.tint(entry.material,c.color,sprite.color.a*(isShadow?c.opacity:1));entry.material.setFloat("intensity",isShadow?1:c.intensity);entry.material.setFloat("hue",isShadow?0:sprite.hueDegrees*Math.PI/180);
      const parameters:MaskParameters=isShadow?{type:"DropShadow",sigmaWorld:c.sigmaWorld}:{type:"Glow",sigmaWorld:c.sigmaWorld,threshold:c.threshold,softness:c.softness};
      const key=JSON.stringify([scene.source(sprite.asset),asset,state.frame,parameters,resolution]);
      if(this.keys.get(type)!==key){
        this.keys.set(type,key);const revision=(this.revisions.get(type)||0)+1;this.revisions.set(type,revision);
        this.jobs.set(type,r.resources.texture("mask:"+key,{kind:"mask",source:maskSource,asset,component:parameters,resolution}).then(result=>{
          if(this.revisions.get(type)!==revision)return;
          this.textures.get(type)?.dispose();const texture=r.texture(`${this.id}/${type}`,result,{linear:true});this.textures.set(type,texture);entry.material.setTexture("spriteTex",texture);
          const b=result.bounds!;r.rect(entry.mesh,b.left,b.bottom,b.right,b.top);
        }));
      }
      jobs.push(this.jobs.get(type));
    }
    await Promise.all(jobs);
  }
  dispose(){this.disposed=true;this.filter?.dispose();for(const type of this.revisions.keys())this.revisions.set(type,(this.revisions.get(type)||0)+1);for(const {mesh,material} of this.meshes.values()){mesh.dispose();material.dispose();}this.textures.forEach(t=>t.dispose());}
}

class TiledSprite {
  readonly renderer:BabylonRenderer;readonly id:string;
  readonly textures:Map<string,Babylon.RawTexture>;readonly keys:Map<string,string>;readonly jobs:Map<string,Promise<void>>;readonly revisions:Map<string,number>;
  updateRevision=0;disposed=false;
  readonly material:Babylon.ShaderMaterial;readonly mesh:Babylon.Mesh;transparent=false;hasAlpha=false;alphaSource?:PixelImage;
  constructor(renderer:BabylonRenderer,node:Entity){
    this.renderer=renderer;this.id=node.id;const B=renderer.B;
    this.material=new B.ShaderMaterial(`${node.name} / TiledSpriteRenderer`,renderer.scene,{vertex:"sceneEntity",fragment:"sceneBackground"},{attributes:["position","uv"],uniforms:["worldViewProjection","tileOrigin","tileSize","noiseOrigin","noiseSize","noiseRange","noiseEnabled","noiseChannelGain","tint","saturation","verticalWrap","directionalSigma","blurDirection","clipEnabled","clipBounds","cropSigma","glowSigma","glowGain"],samplers:["backgroundTex","haloTex","noiseTex"]});
    this.material.needAlphaBlending=()=>Boolean(this.transparent);
    this.material.backFaceCulling=false;this.mesh=renderer.quad(node.name,node.id,this.material);this.textures=new Map();this.keys=new Map();this.jobs=new Map();this.revisions=new Map();
    this.material.setTexture("noiseTex",renderer.neutralTexture);
    this.material.setTexture("haloTex",renderer.neutralTexture);
  }
  async update(scene:Scene,view:View){
    const r=this.renderer,c=scene.requireComponent(this.id,"TiledSpriteRenderer"),asset=scene.asset(c.asset),blur=scene.component(this.id,"GaussianBlur"),noise=scene.component(this.id,"ProceduralNoise"),resolution=Math.max(scene.data.rendering.texturePixelsPerUnit,c.clipBounds?asset.pixelsPerUnit*8:0);
    const bounds=clippedBounds(scene.coverage(this.id,view),c.clipBounds),glow=scene.component(this.id,"Glow"),sigma=enabled(blur)?blur.sigmaWorld:{x:0,y:0};this.mesh.setEnabled(c.enabled&&Boolean(bounds));
    const halo=glow?.enabled?glow.sigmaWorld:0,pad=4*Math.max(sigma.x,sigma.y,halo);
    if(bounds)r.rect(this.mesh,bounds.left-pad,bounds.bottom-pad,bounds.right+pad,bounds.top+pad);
    this.material.setFloat("clipEnabled",c.clipBounds?1:0);this.material.setVector4("clipBounds",new r.B.Vector4(bounds?.left??0,bounds?.bottom??0,bounds?.right??1,bounds?.top??1));r.vec2(this.material,"cropSigma",sigma);this.material.setFloat("glowSigma",halo);this.material.setFloat("glowGain",glow?.enabled?glow.intensity:0);
    r.vec2(this.material,"tileOrigin",c.origin);r.vec2(this.material,"tileSize",{x:asset.size.x/asset.pixelsPerUnit,y:asset.size.y/asset.pixelsPerUnit});
    r.tint(this.material,c.color);this.material.setFloat("saturation",c.saturation);this.material.setFloat("verticalWrap",{clamp:0,clampBottom:1,transparent:2,repeat:3,repeatBottom:4}[c.wrap.y]);
    const directional=scene.component(this.id,"DirectionalBlur"),angle=(directional?.angleDegrees??0)*Math.PI/180;this.material.setFloat("directionalSigma",enabled(directional)?directional.sigmaWorld:0);r.vec2(this.material,"blurDirection",{x:Math.cos(angle),y:Math.sin(angle)});
    r.vec2(this.material,"noiseOrigin",noise?.origin||{x:0,y:0});r.vec2(this.material,"noiseSize",noise?.worldSize||{x:1,y:1});this.material.setFloat("noiseRange",noise?.range||0);this.material.setFloat("noiseEnabled",enabled(noise)&&noise.bands.some(b=>b.variance>0)?1:0);
    this.material.setVector3("noiseChannelGain",new r.B.Vector3(noise?.channelGain.r??1,noise?.channelGain.g??1,noise?.channelGain.b??1));
    const revision=this.updateRevision=(this.updateRevision||0)+1;
    const source=await r.resources.image(scene,c.asset);if(this.disposed||revision!==this.updateRevision)return;
    if(this.alphaSource!==source){this.alphaSource=source;this.hasAlpha=source.data.some((value,index)=>index%4===3&&value<255);}
    this.transparent=this.hasAlpha||c.color.a<1||!!c.clipBounds;this.material.disableDepthWrite=this.transparent;
    const repeatY=c.wrap.y==="repeat"||c.wrap.y==="repeatBottom";
    const key=JSON.stringify([scene.source(c.asset),asset,sigma,resolution,repeatY]);
    const jobs:(Promise<void>|undefined)[]=[];
    const schedule=(name:string,key:string,input:TextureJob,options:TextureOptions)=>{
      if(this.keys.get(name)!==key){this.keys.set(name,key);const revision=(this.revisions.get(name)||0)+1;this.revisions.set(name,revision);
        this.jobs.set(name,r.resources.texture(key,input).then(result=>{if(this.revisions.get(name)!==revision)return;this.textures.get(name)?.dispose();const texture=r.texture(`${this.id}/${name}`,result,options);this.textures.set(name,texture);this.material.setTexture(name+"Tex",texture);}));}
      jobs.push(this.jobs.get(name));
    };
    if(sigma.x===0&&sigma.y===0){
      const nativeKey="native:"+scene.source(c.asset);
      if(this.keys.get("background")!==nativeKey){this.keys.set("background",nativeKey);this.revisions.set("background",(this.revisions.get("background")||0)+1);this.textures.get("background")?.dispose();const texture=r.texture(`${this.id}/background`,source,{repeatX:true});this.textures.set("background",texture);this.material.setTexture("backgroundTex",texture);}
    }else schedule("background","tile:"+key,{kind:"tile",source,asset,sigmaWorld:sigma,resolution,repeatY},{repeatX:true,repeatY});
    if(halo>0&&glow?.enabled){
      const haloSigma={x:Math.hypot(sigma.x,halo),y:Math.hypot(sigma.y,halo)},haloResolution=Math.min(resolution,asset.pixelsPerUnit*2);
      const haloKey=JSON.stringify([scene.source(c.asset),asset,haloSigma,haloResolution,repeatY]);
      schedule("halo","tile-halo:"+haloKey,{kind:"tile",source,asset,sigmaWorld:haloSigma,resolution:haloResolution,repeatY},{repeatX:true,repeatY});
    }
    if(noise)schedule("noise",r.resources.noiseKey(noise),{kind:"noise",component:noise},{repeatX:true,repeatY:true});
    await Promise.all(jobs);
    const background=this.textures.get("background");
    if(background)background.wrapV=repeatY?r.B.Texture.WRAP_ADDRESSMODE:r.B.Texture.CLAMP_ADDRESSMODE;
  }
  dispose(){this.disposed=true;for(const type of this.revisions.keys())this.revisions.set(type,(this.revisions.get(type)||0)+1);this.mesh.dispose();this.material.dispose();this.textures.forEach(t=>t.dispose());}
}

export class BabylonRenderer {
  readonly entityOwners=new WeakMap<Babylon.AbstractMesh,string>();
  private readonly transitions=new BabylonTransitions(this);
  private readonly frame=new BabylonViewportFrame(this);
  readonly viewport:HTMLElement;readonly B= B;readonly canvas:HTMLCanvasElement;readonly engine:Babylon.Engine;
  readonly registry:Map<ComponentType,new(renderer:BabylonRenderer,node:Entity)=>RenderObject>;
  objects:RenderObject[];readonly nodes:Map<string,Babylon.TransformNode|Babylon.FreeCamera>;renderCount:number;updateRevision:number;
  resources!:Resources;data!:Scene;scene!:Babylon.Scene;neutralTexture!:Babylon.RawTexture;vignette:Babylon.PostProcess|null=null;attachedCamera:Babylon.FreeCamera|null=null;
  vignettePlane:Babylon.Mesh|null=null;vignetteMaterial:Babylon.ShaderMaterial|null=null;
  constructor(viewport:HTMLElement){
    registerBabylon();installShaders(B);this.viewport=viewport;
    this.canvas=document.createElement("canvas");this.canvas.id="scene";this.canvas.setAttribute("aria-label","Scene viewport");viewport.append(this.canvas);
    this.engine=new B.Engine(this.canvas,false,{preserveDrawingBuffer:true,stencil:true,alpha:false},false);
    this.registry=new Map<ComponentType,new(renderer:BabylonRenderer,node:Entity)=>RenderObject>([["SpriteNumberRenderer",BabylonNumber],["SpriteRenderer",Sprite],["TiledSpriteRenderer",TiledSprite],["ParticleEmitter",BabylonParticles],["PlaneRenderer",BabylonPlane],["LineRenderer",BabylonLine]]);this.objects=[];this.nodes=new Map();this.renderCount=0;this.updateRevision=0;
    this.engine.onContextRestoredObservable.add(()=>this.scene?.executeWhenReady(()=>this.render()));
  }
  async createScene(data:Scene,resources:Resources){
    const B=this.B;this.resources=resources;this.data=data;this.scene=new B.Scene(this.engine);this.scene.clearColor=new B.Color4(0,0,0,1);
    this.neutralTexture=this.texture("neutral",{width:1,height:1,channels:4,data:new Uint8Array([128,128,128,255])});
    this.reconcile(data);
  }
  private reconcile(data:Scene):void {
    this.objects=this.objects.filter(object=>{if(data.nodes.has(object.id))return true;object.dispose();return false;});
    for(const [id,object] of this.nodes)if(!data.nodes.has(id)){object.dispose(true);this.nodes.delete(id);}
    const B=this.B,ensure=(node:Entity):Babylon.TransformNode|Babylon.FreeCamera=>{
      const existing=this.nodes.get(node.id);if(existing)return existing;
      const parent=data.parents.get(node.id);
      const object=data.component(node.id,"Camera")?new B.FreeCamera(node.name,B.Vector3.Zero(),this.scene):new B.TransformNode(node.name,this.scene);
      object.id=node.id;object.parent=parent?ensure(parent):null;this.nodes.set(node.id,object);
      for(const [type,Handler] of this.registry)if(data.component(node.id,type))this.objects.push(new Handler(this,node));
      return object;
    };
    for(const node of data.nodes.values())ensure(node);
  }
  texture(name:string,asset:PixelImage,{linear=false,repeatX=false,repeatY=false}:TextureOptions={}){
    const B=this.B,rgba=new Uint8Array(asset.width*asset.height*4);
    for(let i=0;i<asset.width*asset.height;i++){const a=i*asset.channels,b=i*4;rgba[b]=asset.data[a];rgba[b+1]=asset.data[a+(asset.channels===1?0:1)];rgba[b+2]=asset.data[a+(asset.channels===1?0:2)];rgba[b+3]=asset.channels===4?asset.data[a+3]:255;}
    const t=B.RawTexture.CreateRGBATexture(rgba,asset.width,asset.height,this.scene,false,false,linear?B.Texture.BILINEAR_SAMPLINGMODE:B.Texture.NEAREST_SAMPLINGMODE);t.name=name;t.gammaSpace=false;t.wrapU=repeatX?B.Texture.WRAP_ADDRESSMODE:B.Texture.CLAMP_ADDRESSMODE;t.wrapV=repeatY?B.Texture.WRAP_ADDRESSMODE:B.Texture.CLAMP_ADDRESSMODE;return t;
  }
  spriteMaterial(name:string,mask:boolean,additive:boolean){
    const B=this.B,m=new B.ShaderMaterial(name,this.scene,{vertex:"sceneEntity",fragment:"sceneSprite"},{attributes:["position","uv"],uniforms:["worldViewProjection","tint","maskOnly","intensity","hue","saturation","brightness","whiteMix","motionArt","motionEnabled","motionAmount","motionCount","motionCenter","motionOffset","motionGain","filterPadding","filterFrame","filterCell","filterGrid","uvRect","uvBounds","noiseOrigin","noiseSize","noiseRange","noiseEnabled","noiseChannelGain","opacityGradientEnabled","opacityGradientStart","opacityGradientEnd"],samplers:["spriteTex","noiseTex","filteredTex"],needAlphaBlending:true});
    m.setVector4("uvRect",new B.Vector4(0,0,1,1));m.setVector4("uvBounds",new B.Vector4(0,0,1,1));m.setFloat("saturation",1);m.setFloat("brightness",1);m.setFloat("whiteMix",0);m.setFloat("motionEnabled",0);m.setFloat("motionAmount",0);m.setInt("motionCount",25);m.setVector4("motionArt",new B.Vector4(0,0,1,1));this.vec2(m,"motionCenter",{x:0,y:0});this.vec2(m,"motionOffset",{x:0,y:0});
    this.vec2(m,"noiseOrigin",{x:0,y:0});this.vec2(m,"noiseSize",{x:1,y:1});m.setFloat("noiseRange",0);m.setFloat("noiseEnabled",0);m.setTexture("noiseTex",this.neutralTexture);
    m.setVector3("noiseChannelGain",new B.Vector3(1,1,1));
    m.setTexture("filteredTex",this.neutralTexture);m.setFloat("filterPadding",0);m.setFloat("filterFrame",0);m.setFloat("motionGain",1);this.vec2(m,"filterCell",{x:1,y:1});this.vec2(m,"filterGrid",{x:1,y:1});
    m.setFloat("opacityGradientEnabled",0);this.vec2(m,"opacityGradientStart",{x:0,y:0});this.vec2(m,"opacityGradientEnd",{x:0,y:-1});
    m.backFaceCulling=false;m.disableDepthWrite=true;m.alphaMode=additive?B.Engine.ALPHA_ADD:B.Engine.ALPHA_COMBINE;m.setFloat("maskOnly",mask?1:0);m.setFloat("intensity",1);m.setFloat("hue",0);m.setTexture("spriteTex",this.neutralTexture);return m;
  }
  quad(name:string,id:string|null,material:Babylon.Material,owner=id){const mesh=this.B.CreatePlane(name,{size:1,updatable:true},this.scene);mesh.parent=id?this.nodes.get(id)||null:null;mesh.material=material;mesh.alwaysSelectAsActiveMesh=true;if(owner)this.entityOwners.set(mesh,owner);return mesh;}
  rect(mesh:Babylon.Mesh,left:number,bottom:number,right:number,top:number){mesh.updateVerticesData(this.B.VertexBuffer.PositionKind,[left,bottom,0,right,bottom,0,right,top,0,left,top,0]);mesh.refreshBoundingInfo();}
  vec2(material:Babylon.ShaderMaterial,name:string,value:Vec2){material.setVector2(name,new this.B.Vector2(value.x,value.y));}
  tint(material:Babylon.ShaderMaterial,c:Color,opacity=1){material.setVector4("tint",new this.B.Vector4(c.r,c.g,c.b,c.a*opacity));}
  async update(data:Scene,view:View){
    this.reconcile(data);
    const B=this.B,current=++this.updateRevision,scene=this.scene;
    for(const [id,node] of data.nodes){
      const object=this.nodes.get(id)!,t=data.transformAt(id);object.position.set(t.localPosition.x,t.localPosition.y,t.localPosition.z);if(object instanceof B.TransformNode)object.scaling.set(t.localScale.x,t.localScale.y,t.localScale.z);
      const rotation=M.trs({...t,localPosition:{x:0,y:0,z:0},localScale:{x:1,y:1,z:1}});object.rotationQuaternion=B.Quaternion.FromRotationMatrix(B.Matrix.FromArray(rotation));object.setEnabled(data.active.get(id)||false);
    }
    this.engine.setSize(Math.max(1,Math.round(view.width*view.dpr)),Math.max(1,Math.round(view.height*view.dpr)));
    const camera=this.nodes.get(data.cameraNode.id) as Babylon.FreeCamera,c=data.requireComponent(data.cameraNode.id,"Camera");
    scene.clearColor=new B.Color4(c.clearColor.r,c.clearColor.g,c.clearColor.b,c.clearColor.a);
    camera.mode=c.projection==="perspective"?B.Camera.PERSPECTIVE_CAMERA:B.Camera.ORTHOGRAPHIC_CAMERA;
    camera.fovMode=B.Camera.FOVMODE_VERTICAL_FIXED;camera.fov=2*Math.atan(view.worldHeight/(2*data.projectionDistance));
    camera.orthoLeft=-view.worldWidth/2;camera.orthoRight=view.worldWidth/2;camera.orthoBottom=-view.worldHeight/2;camera.orthoTop=view.worldHeight/2;camera.minZ=c.near;camera.maxZ=c.far;
    camera.unfreezeProjectionMatrix();
    if(c.projection==="perspective"&&(c.principalPoint.x!==.5||c.principalPoint.y!==.5)){
      const projection=camera.getProjectionMatrix(true).clone(),offset=data.projectionOffset;
      projection.setRowFromFloats(2,2*offset.x/view.worldWidth,2*offset.y/view.worldHeight,projection.m[10],projection.m[11]);camera.freezeProjectionMatrix(projection);
    }
    if(!this.vignette||this.attachedCamera!==camera){
      this.vignette?.dispose();scene.activeCamera=camera;
      this.attachedCamera=camera;
      this.vignette=new B.PostProcess("Camera / Vignette","sceneVignette",["center","shape","enabled"],null,1,camera,B.Texture.NEAREST_SAMPLINGMODE,this.engine,false);
      this.vignette.onApply=effect=>{const v=this.data.component(this.data.cameraNode.id,"Vignette");effect.setFloat2("center",v?.centerViewport.x||0,v?.centerViewport.y||0);effect.setFloat3("shape",v?.quadratic||0,v?.quartic||0,v?.verticalWeight||1);effect.setFloat("enabled",enabled(v)&&v.depth===null?1:0);};
    }
    const v=data.component(data.cameraNode.id,"Vignette"),depth=v?.depth,placed=enabled(v)&&depth!==null&&depth!==undefined;
    if(placed){
      if(!this.vignettePlane){
        this.vignetteMaterial=new B.ShaderMaterial("Camera / depth vignette",scene,{vertex:"sceneEntity",fragment:"sceneVignettePlane"},{attributes:["position","uv"],uniforms:["worldViewProjection","halfSize","center","shape"],needAlphaBlending:true});this.vignetteMaterial.backFaceCulling=false;this.vignetteMaterial.disableDepthWrite=true;
        this.vignettePlane=this.quad("Camera / depth vignette",null,this.vignetteMaterial);
      }
      const mesh=this.vignettePlane,material=this.vignetteMaterial!;mesh.setEnabled(depth>=c.near&&depth<=c.far);mesh.parent=camera;mesh.position.z=depth;
      const scale=data.frustumScale(depth);
      const offset=data.projectionOffset;mesh.position.x=-offset.x*scale;mesh.position.y=-offset.y*scale;
      this.rect(mesh,-view.worldWidth*scale/2,-view.worldHeight*scale/2,view.worldWidth*scale/2,view.worldHeight*scale/2);this.vec2(material,"halfSize",{x:view.worldWidth*scale/2,y:view.worldHeight*scale/2});this.vec2(material,"center",v.centerViewport);material.setVector3("shape",new B.Vector3(v.quadratic,v.quartic,v.verticalWeight));
    }else if(this.vignettePlane){this.vignettePlane.dispose();this.vignettePlane=null;this.vignetteMaterial?.dispose();this.vignetteMaterial=null;}
    this.frame.update(data,view,camera);
    await Promise.all(this.objects.map(object=>object.update(data,view)));if(current!==this.updateRevision)return;
    orderParticleDraws(this.objects,data);
    this.transitions.update(transitionGroups(data,view));
    // Transparent component planes use view depth, also for off-center cameras.
    const viewMatrix=M.inverse(data.world.get(data.cameraNode.id)!);
    const transparent=scene.meshes.filter(mesh=>mesh.material?.needAlphaBlending()).map(mesh=>{mesh.computeWorldMatrix(true);const metadata=mesh.metadata as {sortWorldPosition?:Vec3;sortOrder?:number}|null,p=metadata?.sortWorldPosition||mesh.getBoundingInfo().boundingSphere.centerWorld;return {mesh,z:M.point(viewMatrix,p).z,order:metadata?.sortOrder??0};}).sort((a,b)=>b.z-a.z||a.order-b.order);
    transparent.forEach(({mesh},index)=>mesh.alphaIndex=index);
    await scene.whenReadyAsync();if(current===this.updateRevision)this.render();
  }
  render(){this.scene.render();this.renderCount++;}
  disposeScene(){this.updateRevision++;this.objects.forEach(o=>o.dispose());this.objects=[];this.transitions.dispose();this.frame.dispose();this.nodes.clear();this.vignette?.dispose();this.vignette=null;this.attachedCamera=null;this.vignettePlane?.dispose();this.vignettePlane=null;this.vignetteMaterial?.dispose();this.vignetteMaterial=null;this.neutralTexture?.dispose();this.scene?.dispose();this.scene=null!;}
  dispose(){this.disposeScene();this.engine.dispose();this.canvas.remove();}
}
