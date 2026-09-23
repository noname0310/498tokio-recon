import type * as Babylon from "@babylonjs/core/pure";
import type { BabylonSceneContext } from "./babylon-context.js";
import type { Scene } from "./scene.js";
import type { Entity, Vec3, View, ParticleState, RenderObject } from "./types.js";
import {BabylonParticleFilter,particleFilterResolution} from "./babylon-particle-filter.js";
import {Math3D as M} from "./math.js";
/* One thin-instance draw per emitter, plus an optional GPU-blurred glow draw. */
const vertex=`precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 world0,world1,world2,world3,particleColor,particleRect;
attribute vec2 particleBlur;
uniform mat4 viewProjection;
uniform vec2 padding;
varying vec2 localUV;
varying vec4 tint,rect;
varying vec2 blurUV;
void main(){
  vec2 p=position.xy*(1.0+2.0*(padding+4.0*abs(particleBlur)));
  gl_Position=viewProjection*mat4(world0,world1,world2,world3)*vec4(p,0.0,1.0);
  localUV=vec2(p.x+.5,.5-p.y);tint=particleColor;rect=particleRect;blurUV=particleBlur;
}`;
const fragment=`precision highp float;
uniform sampler2D spriteTex,filteredTex,glowTex;
uniform vec2 textureSize,sigmaUV,cellSize,atlasStride,atlasGrid;
uniform float glowOnly,threshold,softness,intensity,filterPadding,glowPadding,alphaGain;
uniform vec4 glowColor;
varying vec2 localUV;
varying vec4 tint,rect;
varying vec2 blurUV;
vec4 sampleArt(vec2 p){
  if(filterPadding>0.0){
    vec2 expanded=cellSize+2.0*filterPadding,at=filterPadding+p*cellSize;
    if(any(lessThan(at,vec2(0.0)))||any(greaterThanEqual(at,expanded)))return vec4(0.0);
    vec2 tile=floor(rect.xy*textureSize/atlasStride);
    vec4 s=texture2D(filteredTex,(tile*expanded+at)/(expanded*atlasGrid));
    return vec4(s.rgb/max(s.a,0.000001),s.a);
  }
  if(p.x<0.0||p.y<0.0||p.x>=1.0||p.y>=1.0)return vec4(0.0);
  return texture2D(spriteTex,clamp(rect.xy+p*rect.zw,rect.xy+.5/textureSize,rect.xy+rect.zw-.5/textureSize));
}
float sampleGlow(vec2 p){
  vec2 expanded=cellSize+2.0*glowPadding,at=glowPadding+p*cellSize;
  if(any(lessThan(at,vec2(0.0)))||any(greaterThanEqual(at,expanded)))return 0.0;
  vec2 tile=floor(rect.xy*textureSize/atlasStride);
  return texture2D(glowTex,(tile*expanded+at)/(expanded*atlasGrid)).a;
}
void main(){
  if(glowOnly<.5){
    if(dot(blurUV,blurUV)<0.000000000001){vec4 s=sampleArt(localUV);s.a=clamp(s.a*alphaGain,0.0,1.0);gl_FragColor=s*tint;return;}
    vec4 sum=vec4(0.0);float weights=0.0;
    for(int i=-12;i<=12;i++){float x=float(i)*.25,w=exp(-.5*x*x);vec4 s=sampleArt(localUV+blurUV*x);sum+=vec4(s.rgb*s.a,s.a)*w;weights+=w;}
    gl_FragColor=vec4(sum.rgb/max(sum.a,0.000001),clamp(sum.a/weights*alphaGain,0.0,1.0))*tint;return;
  }
  // Gaussian mask filtering is shared across instances in a two-pass GPU
  // atlas. Sparse taps over nearest-neighbour artwork produced checkerboards.
  float sum=sampleGlow(localUV),weights=1.0;
  if(dot(blurUV,blurUV)>.000000000001){
    sum=0.0;weights=0.0;
    for(int i=-12;i<=12;i++){float x=float(i)*.25,w=exp(-.5*x*x);sum+=sampleGlow(localUV+blurUV*x)*w;weights+=w;}
  }
  gl_FragColor=vec4(glowColor.rgb*tint.rgb,clamp(sum/weights*intensity*glowColor.a*alphaGain,0.0,1.0)*tint.a);
}`;

interface ParticleDraw {mesh:Babylon.Mesh;glow:boolean;uploadedMatrices?:Float32Array}

/** Bind storage only for a draw that will run. Newly bound arrays already upload. */
function uploadInstances(entry:ParticleDraw,matrices:Float32Array,colors:Float32Array,rects:Float32Array,blurs:Float32Array,count:number):void {
  const mesh=entry.mesh;
  if(entry.uploadedMatrices!==matrices){
    mesh.thinInstanceSetBuffer("matrix",matrices,16,false);mesh.thinInstanceSetBuffer("particleColor",colors,4,false);
    mesh.thinInstanceSetBuffer("particleRect",rects,4,false);mesh.thinInstanceSetBuffer("particleBlur",blurs,2,false);
    entry.uploadedMatrices=matrices;
  }else{
    // Babylon uploads only thinInstanceCount matrices. Set the new count first
    // when a retained batch grows without reallocating its capacity.
    mesh.thinInstanceCount=count;
    mesh.thinInstanceBufferUpdated("matrix");mesh.thinInstanceBufferUpdated("particleColor");
    mesh.thinInstanceBufferUpdated("particleRect");mesh.thinInstanceBufferUpdated("particleBlur");
  }
  mesh.thinInstanceCount=count;
}

export class BabylonParticles {
  readonly renderer:BabylonSceneContext;readonly id:string;readonly entries:(ParticleDraw&{material:Babylon.ShaderMaterial})[];
  capacity:number;count:number;matrices!:Float32Array;colors!:Float32Array;rects!:Float32Array;blurs!:Float32Array;revision=0;sourceKey?:string;texture?:Babylon.RawTexture;disposed=false;
  filter?:BabylonParticleFilter;
  glowFilter?:BabylonParticleFilter;
  states:ParticleState[]=[];sortBySize=false;sortOrigin:Vec3={x:0,y:0,z:0};
  private readonly runs:ParticleDrawRun[]=[];private runCount=0;
  constructor(renderer:BabylonSceneContext,node:Entity){
    this.renderer=renderer;this.id=node.id;this.entries=[];this.capacity=0;this.count=0;
    const B=renderer.B;B.Effect.ShadersStore.sceneParticleVertexShader=vertex;B.Effect.ShadersStore.sceneParticleFragmentShader=fragment;
    for(const glow of [false,...(node.components.some(c=>c.type==="Glow")?[true]:[])]){
      const name=`${node.name} / ${glow?"Glow":"ParticleEmitter"}`;
      const material=new B.ShaderMaterial(name,renderer.scene,{vertex:"sceneParticle",fragment:"sceneParticle"},{attributes:["position","uv","world0","world1","world2","world3","particleColor","particleRect","particleBlur"],uniforms:["viewProjection","padding","textureSize","sigmaUV","glowOnly","threshold","softness","intensity","glowColor","cellSize","atlasStride","atlasGrid","filterPadding","glowPadding","alphaGain"],samplers:["spriteTex","filteredTex","glowTex"],needAlphaBlending:true});
      material.backFaceCulling=false;material.disableDepthWrite=true;material.setFloat("glowOnly",glow?1:0);
      material.setTexture("spriteTex",renderer.neutralTexture);
      material.setTexture("filteredTex",renderer.neutralTexture);
      material.setTexture("glowTex",renderer.neutralTexture);
      const mesh=renderer.quad(name,null,material,this.id);renderer.rect(mesh,-.5,-.5,.5,.5);mesh.isVisible=false;
      this.entries.push({mesh,material,glow});
    }
  }
  allocate(count:number){
    if(count<=this.capacity)return;
    this.capacity=Math.max(count,this.capacity*2,16);
    this.matrices=new Float32Array(this.capacity*16);this.colors=new Float32Array(this.capacity*4);this.rects=new Float32Array(this.capacity*4);this.blurs=new Float32Array(this.capacity*2);
  }
  prepareShaders():void {
    this.allocate(1);
    for(const entry of this.entries)uploadInstances(entry,this.matrices,this.colors,this.rects,this.blurs,1);
  }
  async update(scene:Scene,view:View){
    const r=this.renderer,B=r.B,c=scene.requireComponent(this.id,"ParticleEmitter"),asset=scene.asset(c.asset),glow=scene.component(this.id,"Glow"),cell=asset.atlas?.cellSize||asset.size;
    const revision=++this.revision;
    if(!scene.active.get(this.id)||!c.enabled||!r.resources.isImageReady(c.asset)){this.states=[];this.count=0;for(const entry of this.entries)entry.mesh.isVisible=false;return;}
    const source=await r.resources.image(scene,c.asset);
    if(this.disposed||revision!==this.revision)return;
    const key=JSON.stringify([scene.source(c.asset),asset.filter]);
    if(this.sourceKey!==key){this.sourceKey=key;this.texture?.dispose();this.texture=r.texture(`${this.id}/atlas`,source,{linear:asset.filter==="linear"});for(const e of this.entries)e.material.setTexture("spriteTex",this.texture);}
    const motion=scene.component(this.id,"ParticleMotionBlur"),dilation=motion?.enabled?motion.dilationPixels:0,shapeSoftness=motion?.enabled?motion.softnessPixels:0,alphaGain=motion?.enabled?motion.alphaGain:1;
    const filtered=dilation>0||shapeSoftness>0,filterPadding=filtered?Math.ceil(dilation+4*shapeSoftness)+1:0;
    if(filtered){this.filter??=new BabylonParticleFilter(r,this.id);await this.filter.update(asset,this.texture!,dilation,shapeSoftness);if(this.disposed||revision!==this.revision)return;}
    const glowSigma=glow?.enabled?glow.sigmaWorld*asset.pixelsPerUnit:0,glowSoftness=Math.hypot(glowSigma,shapeSoftness),glowPadding=Math.ceil(dilation+4*glowSoftness)+1;
    if(glow?.enabled){this.glowFilter??=new BabylonParticleFilter(r,`${this.id}/glow`);await this.glowFilter.update(asset,this.texture!,dilation,glowSoftness,glow);if(this.disposed||revision!==this.revision)return;}
    const states=this.states=scene.particleStates(this.id,scene.timelineTime,view);this.count=states.length;this.allocate(this.count);this.sortBySize=c.sortMode==="sizeAscending";
    const origin=scene.world.get(this.id)!;this.sortOrigin={x:origin[12],y:origin[13],z:origin[14]};
    const center={x:0,y:0,z:0},camera=scene.world.get(scene.cameraNode.id)!;for(const s of states)for(const k of ["x","y","z"] as const)center[k]+=s.position[k]/this.count;
    states.forEach((s,i)=>{this.matrices.set(s.matrix,i*16);this.colors.set([s.color.r,s.color.g,s.color.b,s.color.a],i*4);this.rects.set([s.rect.x,s.rect.y,s.rect.width,s.rect.height],i*4);this.blurs.set([s.blurUV.x,s.blurUV.y],i*2);});
    for(const entry of this.entries){
      const {mesh,material,glow:isGlow}=entry;
      mesh.metadata={sortWorldPosition:Object.fromEntries((["x","y","z"] as const).map((k,i)=>[k,center[k]+(isGlow?camera[8+i]*.0001:0)]))};
      mesh.isVisible=!this.sortBySize&&this.count>0&&(!isGlow||Boolean(glow?.enabled));
      if(mesh.isVisible)uploadInstances(entry,this.matrices,this.colors,this.rects,this.blurs,this.count);
      material.alphaMode=(isGlow?glow?.blend==="additive":c.blend==="additive")?B.Engine.ALPHA_ADD:B.Engine.ALPHA_COMBINE;
      r.vec2(material,"textureSize",asset.size);
      r.vec2(material,"cellSize",cell);r.vec2(material,"atlasStride",{x:cell.x+2*(asset.atlas?.padding||0),y:cell.y+2*(asset.atlas?.padding||0)});r.vec2(material,"atlasGrid",{x:asset.atlas?.columns||1,y:asset.atlas?.rows||1});
      material.setFloat("filterPadding",filterPadding);material.setFloat("alphaGain",alphaGain);material.setTexture("filteredTex",filtered?this.filter!.texture!:r.neutralTexture);
      material.setFloat("glowPadding",glowPadding);material.setTexture("glowTex",glow?.enabled?this.glowFilter!.texture!:r.neutralTexture);
      const sigma=isGlow&&glow?glow.sigmaWorld*asset.pixelsPerUnit:0;
      // Bilinear sampling extends half a working texel beyond the morphology
      // support. Include it even with zero softness, or thin edges get clipped.
      const support=dilation+4*shapeSoftness+(filtered?.5/particleFilterResolution:0);
      r.vec2(material,"sigmaUV",{x:sigma/cell.x,y:sigma/cell.y});r.vec2(material,"padding",{x:(4*sigma+support)/cell.x,y:(4*sigma+support)/cell.y});
      material.setFloat("threshold",glow?.threshold??0);material.setFloat("softness",glow?.softness??1);material.setFloat("intensity",glow?.intensity??1);
      const tint=glow?.color||{r:1,g:1,b:1,a:1};material.setVector4("glowColor",new B.Vector4(tint.r,tint.g,tint.b,tint.a));
    }
  }
  resetRuns():void {this.runCount=0;for(const run of this.runs)run.hide();}
  drawRun(first:number,count:number,order:number,scene:Scene):void {
    const index=this.runCount++,run=this.runs[index]??(this.runs[index]=new ParticleDrawRun(this,index));
    run.update(first,count,order,Boolean(scene.component(this.id,"Glow")?.enabled));
  }
  dispose(){this.disposed=true;this.revision++;for(const run of this.runs)run.dispose();for(const {mesh,material} of this.entries){mesh.dispose();material.dispose();}this.texture?.dispose();this.filter?.dispose();this.glowFilter?.dispose();}
}

/** Reuse thin-instance batches for consecutive particles sharing one material.
 * Splitting at material boundaries preserves strict size order across emitters. */
class ParticleDrawRun {
  private readonly entries:ParticleDraw[];
  private capacity=0;private matrices=new Float32Array(0);private colors=new Float32Array(0);private rects=new Float32Array(0);private blurs=new Float32Array(0);
  constructor(private readonly owner:BabylonParticles,index:number){
    this.entries=owner.entries.map(({material,glow})=>{
      const mesh=owner.renderer.quad(`${owner.id}/size-order/${index}/${glow?"glow":"body"}`,null,material,owner.id);owner.renderer.rect(mesh,-.5,-.5,.5,.5);mesh.isVisible=false;return {mesh,glow};
    });
  }
  update(first:number,count:number,order:number,glowEnabled:boolean):void {
    if(count>this.capacity){
      this.capacity=Math.max(count,this.capacity*2,8);this.matrices=new Float32Array(this.capacity*16);this.colors=new Float32Array(this.capacity*4);this.rects=new Float32Array(this.capacity*4);this.blurs=new Float32Array(this.capacity*2);
    }
    const copy=(target:Float32Array,source:Float32Array,stride:number)=>{for(let i=0;i<count*stride;i++)target[i]=source[first*stride+i];};
    copy(this.matrices,this.owner.matrices,16);copy(this.colors,this.owner.colors,4);copy(this.rects,this.owner.rects,4);copy(this.blurs,this.owner.blurs,2);
    for(const entry of this.entries){
      const {mesh,glow}=entry;
      mesh.metadata={sortWorldPosition:this.owner.sortOrigin,sortOrder:order*2+(glow?0:1)};mesh.isVisible=!glow||glowEnabled;
      if(mesh.isVisible)uploadInstances(entry,this.matrices,this.colors,this.rects,this.blurs,count);
    }
  }
  hide():void {for(const {mesh} of this.entries)mesh.isVisible=false;}
  dispose():void {for(const {mesh} of this.entries)mesh.dispose();}
}

export function orderParticleDraws(objects:RenderObject[],scene:Scene):void {
  const inverseCamera=M.inverse(scene.world.get(scene.cameraNode.id)!);
  const sorted:{owner:BabylonParticles;index:number;area:number;depth:number;emitter:number}[]=[];
  objects.forEach((object,emitter)=>{
    if(!(object instanceof BabylonParticles))return;object.resetRuns();if(!object.sortBySize)return;
    const depth=M.point(inverseCamera,object.sortOrigin).z;
    object.states.forEach((state,index)=>sorted.push({owner:object,index,area:state.projectedArea,depth,emitter}));
  });
  sorted.sort((a,b)=>b.depth-a.depth||a.area-b.area||a.emitter-b.emitter||a.index-b.index);
  for(let i=0;i<sorted.length;){
    const first=sorted[i];let end=i+1;
    while(end<sorted.length&&sorted[end].owner===first.owner&&sorted[end].index===first.index+end-i)end++;
    first.owner.drawRun(first.index,end-i,i,scene);i=end;
  }
}
