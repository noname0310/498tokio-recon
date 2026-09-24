import {createColorGradeEffect} from "./babylon-color-grade.js";
import type * as Babylon from "@babylonjs/core/pure";
import {BabylonSceneContext,type BabylonObjectConstructor,type BabylonRenderObject} from "./babylon-context.js";
import {createDilationEffect,createSoftnessEffect} from "./babylon-particle-filter.js";
import {createViewportFrameEffect} from "./babylon-viewport-frame.js";
import {createCameraBlurEffect} from "./babylon-camera-blur.js";
import {createTransitionMask} from "./babylon-transitions.js";
import type {ComponentType} from "./types.js";
import type {LoadingProgress} from "./loading-status.js";

interface ShaderJob {name:string;run:()=>Promise<void>}

/** Compile the declarations in an isolated scene on the live engine. No timeline
 * sampling, visible spawns, or guessed combinations of Babylon macros. */
export class BabylonShaderPreparation {
  private readonly objects:BabylonRenderObject[]=[];
  private readonly effects:(Babylon.EffectWrapper|Babylon.PostProcess)[]=[];
  private readonly abort=new AbortController();
  private readonly context:BabylonSceneContext;
  constructor(live:BabylonSceneContext){
    this.context=new BabylonSceneContext(live.engine,live.data,live.resources,()=>{});
  }
  async run(registry:ReadonlyMap<ComponentType,BabylonObjectConstructor>,progress:LoadingProgress):Promise<void>{
    const r=this.context,B=r.B,jobs=new Map<string,ShaderJob>();
    const camera=new B.TargetCamera("Shader preparation",B.Vector3.Zero(),r.scene);r.scene.activeCamera=camera;
    const material=(mesh:Babylon.Mesh)=>{
      const m=mesh.material;if(!(m instanceof B.ShaderMaterial))return false;
      // These render components have no bones, morph targets, fog or clip planes.
      // Include the actual vertex layout and thin-instance state in the recipe.
      const key=JSON.stringify([m.shaderPath,m.options,mesh.getVerticesDataKinds().sort(),mesh.hasThinInstances,m.needAlphaTestingForMesh(mesh)]);
      if(jobs.has(key))return false;
      jobs.set(key,{name:m.name,run:()=>m.forceCompilationAsync(mesh,{useInstances:mesh.hasThinInstances})});return true;
    };
    const post=(key:string,make:()=>Babylon.PostProcess)=>{
      if(!jobs.has(key))jobs.set(key,{name:key,run:async()=>{
        const pass=make();this.effects.push(pass);
        const effect=pass.getEffect()||await new Promise<Babylon.Effect>(resolve=>pass.onEffectCreatedObservable.addOnce(resolve));
        await this.waitForEffect(effect);
      }});
    };
    const wrapper=(key:string,make:()=>Babylon.EffectWrapper)=>{
      if(!jobs.has(key))jobs.set(key,{name:key,run:async()=>{const effect=make();this.effects.push(effect);await this.waitForEffect(effect.effect);}});
    };
    const features=new Set<string>();
    for(const node of r.data.declaredEntities()){
      for(const [type,Handler] of registry)if(node.components.some(c=>c.type===type)){
        const before=r.scene.meshes.length,object=new Handler(r,node);object.prepareShaders?.();
        let unique=false;
        for(const mesh of r.scene.meshes.slice(before))if(mesh instanceof B.Mesh)unique=material(mesh)||unique;
        // Retain only representative objects so their programs survive despawns.
        if(unique)this.objects.push(object);else object.dispose();
      }
      for(const c of node.components){
        if(c.type==="Glow"&&node.components.some(c=>c.type==="ParticleEmitter")){
          wrapper("Dilation / radius 0",()=>createDilationEffect(r,"Preparation",0));
          wrapper("Motion blur / softness",()=>createSoftnessEffect(r,"Preparation"));
        }
        if(c.type==="Camera")post("Camera / Vignette",()=>r.vignetteEffect(camera));
        if((c.type==="GaussianBlur"||c.type==="CameraMotionBlur")&&node.components.some(c=>c.type==="Camera"))post("Camera / GaussianBlur",()=>createCameraBlurEffect(r));
        if(c.type==="ColorGrade")post("Camera / ColorGrade",()=>createColorGradeEffect(r));
        if(c.type==="ViewportFrame")post("Camera / ViewportFrame",()=>createViewportFrameEffect(r,camera));
        if(c.type==="Vignette"&&c.depth!==null&&!features.has("depth-vignette")){
          const mesh=r.quad("Camera / depth vignette",null,r.depthVignetteMaterial());material(mesh);
          features.add("depth-vignette");
        }
        if(c.type==="Transition"&&!features.has("transition-stencil")){
          material(createTransitionMask(r,"Transition").mesh);features.add("transition-stencil");
        }
        if(c.type==="SpriteMotionBlur"||c.type==="ParticleMotionBlur"){
          const max=r.data.sequence?.propertyBounds(node.id,{component:c.type,path:"dilationPixels"},c.dilationPixels).max??c.dilationPixels;
          const softness=r.data.sequence?.propertyBounds(node.id,{component:c.type,path:"softnessPixels"},c.softnessPixels).max??c.softnessPixels;
          if(max>0||softness>0){
            for(let reach=0;reach<=Math.ceil(max);reach++)wrapper(`Dilation / radius ${reach}`,()=>createDilationEffect(r,"Preparation",reach));
            if(softness>0)wrapper("Motion blur / softness",()=>createSoftnessEffect(r,"Preparation"));
          }
        }
      }
    }
    const pending=[...jobs.values()].map(job=>({...job,finish:progress.begin("Shaders",job.name)}));
    try{
      for(const job of pending){
        // Yield between programs so controls and already prepared objects keep playing.
        await new Promise<void>(resolve=>setTimeout(resolve,0));if(this.abort.signal.aborted)return;
        try{await this.interruptible(job.run());}catch(error){if(this.abort.signal.aborted)return;throw new Error(`Could not compile ${job.name}: ${String(error)}`,{cause:error});}
        finally{job.finish();}
      }
    }finally{for(const job of pending)job.finish();}
  }
  private interruptible(pending:Promise<void>):Promise<void>{
    const signal=this.abort.signal;
    return new Promise((resolve,reject)=>{
      const cancel=()=>resolve();signal.addEventListener("abort",cancel,{once:true});
      pending.then(resolve,reject).finally(()=>signal.removeEventListener("abort",cancel));
      if(signal.aborted)cancel();
    });
  }
  private waitForEffect(effect:Babylon.Effect):Promise<void>{
    if(effect.isReady())return Promise.resolve();
    if(effect.getCompilationError())return Promise.reject(new Error(effect.getCompilationError()));
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{effect.onCompileObservable.remove(done);effect.onErrorObservable.remove(failed);this.abort.signal.removeEventListener("abort",cancel);};
      const done=effect.onCompileObservable.add(()=>{cleanup();resolve();});
      const failed=effect.onErrorObservable.add(()=>{cleanup();reject(new Error(effect.getCompilationError()));});
      const cancel=()=>{cleanup();resolve();};this.abort.signal.addEventListener("abort",cancel,{once:true});
      effect.executeWhenCompiled(()=>{});
    });
  }
  dispose():void {
    this.abort.abort();for(const object of this.objects)object.dispose();for(const effect of this.effects)effect.dispose();this.context.dispose();
  }
}
