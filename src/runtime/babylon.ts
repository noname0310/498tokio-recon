import {BabylonNumber} from "./babylon-number.js";
import type * as Babylon from "@babylonjs/core/pure";
import { B, registerBabylon } from "./babylon-library.js";
import type { Scene } from "./scene.js";
import type { Resources } from "./resources.js";
import type { Entity, ComponentType, Vec3, PixelImage, View, TextureJob, MaskParameters, Bounds } from "./types.js";
import {BabylonSceneContext,type BabylonObjectConstructor,type BabylonRenderObject,type TextureOptions} from "./babylon-context.js";

import { Math3D as M } from "./math.js";
import {BabylonPlane,BabylonLine} from "./babylon-geometry.js";
import {BabylonCylinder} from "./babylon-cylinder.js";
import { installShaders } from "./babylon-shaders.js";
import { BabylonParticles,orderParticleDraws } from "./babylon-particles.js";
import {BabylonTransitions} from "./babylon-transitions.js";
import {BabylonViewportFrame} from "./babylon-viewport-frame.js";
import {BabylonCameraBlur} from "./babylon-camera-blur.js";
import {transitionGroups} from "./transitions.js";
import {clippedBounds} from "./geometry.js";
import {motionBounds} from "./sprite-motion-blur.js";
import {BabylonParticleFilter} from "./babylon-particle-filter.js";
import {BabylonShaderPreparation} from "./babylon-preparation.js";
import type {LoadingProgress} from "./loading-status.js";
const enabled=<T extends {enabled:boolean}>(c:T|undefined):c is T=>Boolean(c?.enabled);
interface SpriteMaskTexture {texture:Babylon.RawTexture;bounds:Bounds;bytes:number}

class Sprite {
  private filter?:BabylonParticleFilter;
  private readonly maskTextures=new Map<string,SpriteMaskTexture>();private maskBytes=0;
  readonly renderer:BabylonSceneContext;readonly id:string;
  readonly textures:Map<string,Babylon.RawTexture>;readonly keys:Map<string,string>;readonly jobs:Map<string,Promise<void>>;readonly revisions:Map<string,number>;
  updateRevision=0;disposed=false;
  readonly meshes:Map<string,{mesh:Babylon.Mesh;material:Babylon.ShaderMaterial}>;
  constructor(renderer:BabylonSceneContext,node:Entity){
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
    if(!scene.active.get(this.id)||!state.visible||!r.resources.isImageReady(sprite.asset)){for(const {mesh}of this.meshes.values())mesh.setEnabled(false);return;}
    const source=await r.resources.image(scene,sprite.asset);if(this.disposed||revision!==this.updateRevision)return;
    const sortAnchor=scene.spriteSortAnchor(this.id);
    for(const [type,{mesh}] of this.meshes){
      const metadata=(mesh.metadata??={}) as {sortWorldPosition?:Vec3;sortOrder?:number};
      metadata.sortWorldPosition=sortAnchor;
      metadata.sortOrder=sprite.sortingOrder*4+(sortAnchor?(type==="DropShadow"?-2:type==="Glow"?-1:0):0);
    }
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
    body.material.setFloat("saturation",sprite.saturation);body.material.setFloat("brightness",sprite.brightness);body.material.setFloat("contrast",sprite.contrast);body.material.setFloat("whiteMix",sprite.whiteMix);
    const gradient=scene.component(this.id,"OpacityGradient");body.material.setFloat("opacityGradientEnabled",gradient?.enabled?1:0);r.vec2(body.material,"opacityGradientStart",gradient?.start??{x:0,y:0});r.vec2(body.material,"opacityGradientEnd",gradient?.end??{x:0,y:-1});
    const rect=state.rect;body.material.setVector4("uvRect",new B.Vector4(rect.x/source.width,rect.y/source.height,rect.width/source.width,rect.height/source.height));
    body.material.setVector4("uvBounds",asset.atlas?new B.Vector4((rect.x+.5)/source.width,(rect.y+.5)/source.height,(rect.x+rect.width-.5)/source.width,(rect.y+rect.height-.5)/source.height):new B.Vector4(0,0,1,1));
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
      const c=scene.component(this.id,type),entry=this.meshes.get(type);if(!entry)continue;entry.mesh.setEnabled(state.visible&&enabled(c)&&this.textures.has(type));
      if(!enabled(c))continue;
      const isShadow=c.type==="DropShadow";
      entry.material.alphaMode=!isShadow&&c.blend==="additive"?B.Engine.ALPHA_ADD:B.Engine.ALPHA_COMBINE;
      entry.mesh.position.set(isShadow?c.offsetWorld.x:0,isShadow?c.offsetWorld.y:0,isShadow?.0002:.0001);
      r.tint(entry.material,c.color,sprite.color.a*(isShadow?c.opacity:1));entry.material.setFloat("intensity",isShadow?1:c.intensity);entry.material.setFloat("hue",isShadow?0:sprite.hueDegrees*Math.PI/180);
      const parameters:MaskParameters=isShadow?{type:"DropShadow",sigmaWorld:c.sigmaWorld}:{type:"Glow",sigmaWorld:c.sigmaWorld,threshold:c.threshold,softness:c.softness};
      const key=JSON.stringify([scene.source(sprite.asset),asset,state.frame,parameters,resolution]);
      if(this.keys.get(type)!==key){
        this.keys.set(type,key);const revision=(this.revisions.get(type)||0)+1;this.revisions.set(type,revision);
        const cached=this.maskTextures.get(key);
        if(cached){this.applyMask(type,key,cached);this.jobs.delete(type);}
        else{
          const maskSource=asset.atlas?r.resources.crop(source,rect):source;
          this.jobs.set(type,r.resources.texture("mask:"+key,{kind:"mask",source:maskSource,asset,component:parameters,resolution}).then(result=>{
            if(this.disposed||this.revisions.get(type)!==revision)return;
            const texture=r.texture(`${this.id}/${type}`,result,{linear:true});
            this.applyMask(type,key,{texture,bounds:result.bounds!,bytes:result.width*result.height*4});
          }));
        }
      }
      jobs.push(this.jobs.get(type));
    }
    await Promise.all(jobs);
    if(this.disposed||revision!==this.updateRevision)return;
    for(const type of ["DropShadow","Glow"] as const)this.meshes.get(type)?.mesh.setEnabled(state.visible&&enabled(scene.component(this.id,type))&&this.textures.has(type));
  }
  private applyMask(type:"Glow"|"DropShadow",key:string,mask:SpriteMaskTexture):void {
    if(!this.maskTextures.has(key))this.maskBytes+=mask.bytes;
    this.maskTextures.delete(key);this.maskTextures.set(key,mask);
    this.textures.set(type,mask.texture);const entry=this.meshes.get(type)!;
    entry.material.setTexture("spriteTex",mask.texture);const b=mask.bounds;this.renderer.rect(entry.mesh,b.left,b.bottom,b.right,b.top);
    // LRU limits apply to inactive masks. Never dispose a texture still bound to
    // the current glow/shadow, even if that single mask exceeds the byte budget.
    for(const [oldKey,old] of this.maskTextures){
      if(this.maskTextures.size<=32&&this.maskBytes<=8*1024*1024)break;
      if(old.texture===this.textures.get("Glow")||old.texture===this.textures.get("DropShadow"))continue;
      this.maskTextures.delete(oldKey);this.maskBytes-=old.bytes;old.texture.dispose();
    }
  }
  dispose(){this.disposed=true;this.filter?.dispose();for(const type of this.revisions.keys())this.revisions.set(type,(this.revisions.get(type)||0)+1);for(const {mesh,material} of this.meshes.values()){mesh.dispose();material.dispose();}for(const [type,texture] of this.textures)if(type!=="Glow"&&type!=="DropShadow")texture.dispose();for(const mask of this.maskTextures.values())mask.texture.dispose();this.maskTextures.clear();this.maskBytes=0;}
}

class TiledSprite {
  readonly renderer:BabylonSceneContext;readonly id:string;
  readonly textures:Map<string,Babylon.RawTexture>;readonly keys:Map<string,string>;readonly jobs:Map<string,Promise<void>>;readonly revisions:Map<string,number>;
  updateRevision=0;disposed=false;
  readonly material:Babylon.ShaderMaterial;readonly mesh:Babylon.Mesh;transparent=false;hasAlpha=false;alphaSource?:PixelImage;
  constructor(renderer:BabylonSceneContext,node:Entity){
    this.renderer=renderer;this.id=node.id;const B=renderer.B;
    this.material=new B.ShaderMaterial(`${node.name} / TiledSpriteRenderer`,renderer.scene,{vertex:"sceneEntity",fragment:"sceneBackground"},{attributes:["position","uv"],uniforms:["worldViewProjection","tileOrigin","tileSize","noiseOrigin","noiseSize","noiseRange","noiseEnabled","noiseChannelGain","tint","saturation","verticalWrap","directionalSigma","blurDirection","clipEnabled","clipBounds","cropSigma","glowSigma","glowGain"],samplers:["backgroundTex","haloTex","noiseTex"]});
    this.material.needAlphaBlending=()=>Boolean(this.transparent);
    this.material.backFaceCulling=false;this.mesh=renderer.quad(node.name,node.id,this.material);this.textures=new Map();this.keys=new Map();this.jobs=new Map();this.revisions=new Map();
    this.material.setTexture("noiseTex",renderer.neutralTexture);
    this.material.setTexture("haloTex",renderer.neutralTexture);
  }
  async update(scene:Scene,view:View){
    const r=this.renderer,c=scene.requireComponent(this.id,"TiledSpriteRenderer"),asset=scene.asset(c.asset),blur=scene.component(this.id,"GaussianBlur"),noise=scene.component(this.id,"ProceduralNoise"),resolution=Math.max(scene.data.rendering.texturePixelsPerUnit,c.clipBounds?asset.pixelsPerUnit*8:0);
    if(!scene.active.get(this.id)||!c.enabled||!r.resources.isImageReady(c.asset)){this.mesh.setEnabled(false);return;}
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
    // A hard crop is already part of the quad geometry; it does not make an
    // opaque tile transparent. Keep depth writes so intersecting sprites and
    // laser planes are occluded per fragment, independently of their centres.
    const softCrop=!!c.clipBounds&&pad>0;
    this.transparent=this.hasAlpha||c.color.a<1||softCrop;this.material.disableDepthWrite=this.transparent;
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
  readonly kind="babylon";
  get displayName():string{return `Babylon.js · WebGL${this.engine.webGLVersion}`;}
  private context?:BabylonSceneContext;
  private preparation?:BabylonShaderPreparation;
  private transitions?:BabylonTransitions;
  private frame?:BabylonViewportFrame;
  private cameraBlur?:BabylonCameraBlur;
  private progressiveDraw:number|null=null;
  readonly viewport:HTMLElement;readonly B= B;readonly canvas:HTMLCanvasElement;readonly engine:Babylon.Engine;
  readonly registry:Map<ComponentType,BabylonObjectConstructor>;
  objects:BabylonRenderObject[];renderCount:number;updateRevision:number;
  get resources(){return this.context!.resources;}
  get data(){return this.context!.data;}
  get scene(){return this.context?.scene??null!;}
  get nodes(){return this.context!.nodes;}
  get neutralTexture(){return this.context!.neutralTexture;}
  get entityOwners(){return this.context!.entityOwners;}
  vignette:Babylon.PostProcess|null=null;attachedCamera:Babylon.TargetCamera|null=null;
  vignettePlane:Babylon.Mesh|null=null;vignetteMaterial:Babylon.ShaderMaterial|null=null;
  constructor(viewport:HTMLElement){
    registerBabylon();installShaders(B);this.viewport=viewport;
    this.canvas=document.createElement("canvas");this.canvas.id="scene";this.canvas.setAttribute("aria-label","Scene viewport");viewport.append(this.canvas);
    try{this.engine=new B.Engine(this.canvas,false,{preserveDrawingBuffer:true,stencil:true,alpha:false},false);}
    catch(error){this.canvas.remove();throw error;}
    this.registry=new Map<ComponentType,BabylonObjectConstructor>([["SpriteNumberRenderer",BabylonNumber],["SpriteRenderer",Sprite],["TiledSpriteRenderer",TiledSprite],["CylindricalSpriteRenderer",BabylonCylinder],["ParticleEmitter",BabylonParticles],["PlaneRenderer",BabylonPlane],["LineRenderer",BabylonLine]]);this.objects=[];this.renderCount=0;this.updateRevision=0;
    this.engine.onContextRestoredObservable.add(()=>this.scene?.executeWhenReady(()=>this.render()));
  }
  async createScene(data:Scene,resources:Resources){
    this.context=new BabylonSceneContext(this.engine,data,resources,()=>this.render());
    this.transitions=new BabylonTransitions(this.context);this.frame=new BabylonViewportFrame(this.context);this.cameraBlur=new BabylonCameraBlur(this.context);
    this.reconcile(data);
  }
  async prepare(progress:LoadingProgress):Promise<void>{
    this.preparation?.dispose();
    this.preparation=new BabylonShaderPreparation(this.context!);
    await this.preparation.run(this.registry,progress);
  }
  private reconcile(data:Scene):void {
    this.objects=this.objects.filter(object=>{if(data.nodes.has(object.id))return true;object.dispose();return false;});
    for(const [id,object] of this.nodes)if(!data.nodes.has(id)){object.dispose(true);this.nodes.delete(id);}
    const B=this.B,ensure=(node:Entity):Babylon.TransformNode|Babylon.TargetCamera=>{
      const existing=this.nodes.get(node.id);if(existing)return existing;
      const parent=data.parents.get(node.id);
      const object=data.component(node.id,"Camera")?new B.TargetCamera(node.name,B.Vector3.Zero(),this.scene):new B.TransformNode(node.name,this.scene);
      object.id=node.id;object.parent=parent?ensure(parent):null;this.nodes.set(node.id,object);
      for(const [type,Handler] of this.registry)if(data.component(node.id,type))this.objects.push(new Handler(this.context!,node));
      return object;
    };
    for(const node of data.nodes.values())ensure(node);
  }
  async update(data:Scene,view:View){
    this.cancelProgressiveDraw();
    this.reconcile(data);
    const B=this.B,current=++this.updateRevision,scene=this.scene;
    for(const [id,node] of data.nodes){
      const object=this.nodes.get(id)!,t=data.transformAt(id);object.position.set(t.localPosition.x,t.localPosition.y,t.localPosition.z);if(object instanceof B.TransformNode)object.scaling.set(t.localScale.x,t.localScale.y,t.localScale.z);
      const rotation=M.trs({...t,localPosition:{x:0,y:0,z:0},localScale:{x:1,y:1,z:1}});object.rotationQuaternion=B.Quaternion.FromRotationMatrix(B.Matrix.FromArray(rotation));object.setEnabled(data.active.get(id)||false);
    }
    this.engine.setSize(Math.max(1,Math.round(view.width*view.dpr)),Math.max(1,Math.round(view.height*view.dpr)));
    const camera=this.nodes.get(data.cameraNode.id) as Babylon.TargetCamera,c=data.requireComponent(data.cameraNode.id,"Camera");
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
      this.vignette=this.context!.vignetteEffect(camera);
    }
    const v=data.component(data.cameraNode.id,"Vignette"),depth=v?.depth,placed=enabled(v)&&depth!==null&&depth!==undefined;
    if(placed){
      if(!this.vignettePlane){
        this.vignetteMaterial=this.context!.depthVignetteMaterial();
        this.vignettePlane=this.context!.quad("Camera / depth vignette",null,this.vignetteMaterial);
      }
      const mesh=this.vignettePlane,material=this.vignetteMaterial!;mesh.setEnabled(depth>=c.near&&depth<=c.far);mesh.parent=camera;mesh.position.z=depth;
      const scale=data.frustumScale(depth);
      const offset=data.projectionOffset;mesh.position.x=-offset.x*scale;mesh.position.y=-offset.y*scale;
      this.context!.rect(mesh,-view.worldWidth*scale/2,-view.worldHeight*scale/2,view.worldWidth*scale/2,view.worldHeight*scale/2);this.context!.vec2(material,"halfSize",{x:view.worldWidth*scale/2,y:view.worldHeight*scale/2});this.context!.vec2(material,"center",v.centerViewport);material.setVector3("shape",new B.Vector3(v.quadratic,v.quartic,v.verticalWeight));
    }else if(this.vignettePlane){this.vignettePlane.dispose();this.vignettePlane=null;this.vignetteMaterial?.dispose();this.vignetteMaterial=null;}
    this.cameraBlur!.update(data,view,camera);
    this.frame!.update(data,view,camera);
    let completed=false;
    const partial=()=>{
      if(completed||current!==this.updateRevision||this.progressiveDraw!==null)return;
      // A slow texture must not hold back unrelated prepared objects. Coalesce
      // completions into one draw, and discard it if the full update settles.
      this.progressiveDraw=requestAnimationFrame(()=>{
        this.progressiveDraw=null;if(completed||current!==this.updateRevision)return;
        this.prepareDraw(data,view);this.render();
        scene.executeWhenReady(()=>{if(!completed&&current===this.updateRevision){this.prepareDraw(data,view);this.render();}});
      });
    };
    try{await Promise.all(this.objects.map(async object=>{await object.update(data,view);partial();}));}
    finally{completed=true;if(current===this.updateRevision)this.cancelProgressiveDraw();}
    if(current!==this.updateRevision)return;
    this.prepareDraw(data,view);
    await scene.whenReadyAsync();if(current===this.updateRevision)this.render();
  }
  private prepareDraw(data:Scene,view:View):void {
    const scene=this.scene;
    orderParticleDraws(this.objects,data);
    this.transitions!.update(transitionGroups(data,view));
    // Transparent component planes use view depth, also for off-center cameras.
    const viewMatrix=M.inverse(data.world.get(data.cameraNode.id)!);
    const transparent=scene.meshes.filter(mesh=>mesh.isVisible&&mesh.visibility>0&&mesh.isEnabled()&&mesh.material?.needAlphaBlending()).map(mesh=>{mesh.computeWorldMatrix(true);const metadata=mesh.metadata as {sortWorldPosition?:Vec3;sortOrder?:number}|null,p=metadata?.sortWorldPosition||mesh.getBoundingInfo().boundingSphere.centerWorld;return {mesh,z:M.point(viewMatrix,p).z,order:metadata?.sortOrder??0};}).sort((a,b)=>b.z-a.z||a.order-b.order);
    transparent.forEach(({mesh},index)=>mesh.alphaIndex=index);
  }
  private cancelProgressiveDraw():void {if(this.progressiveDraw!==null)cancelAnimationFrame(this.progressiveDraw);this.progressiveDraw=null;}
  render(){this.scene.render();this.renderCount++;}
  disposeScene(){this.updateRevision++;this.cancelProgressiveDraw();this.preparation?.dispose();this.preparation=undefined;this.objects.forEach(o=>o.dispose());this.objects=[];this.transitions?.dispose();this.frame?.dispose();this.cameraBlur?.dispose();this.transitions=undefined;this.frame=undefined;this.cameraBlur=undefined;this.vignette?.dispose();this.vignette=null;this.attachedCamera=null;this.vignettePlane?.dispose();this.vignettePlane=null;this.vignetteMaterial?.dispose();this.vignetteMaterial=null;this.context?.dispose();this.context=undefined;}
  dispose(){this.disposeScene();this.engine.dispose();this.canvas.remove();}
}
