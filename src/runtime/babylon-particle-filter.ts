import type * as Babylon from "@babylonjs/core/pure";
import type {BabylonRenderer} from "./babylon.js";
import type {SpriteAsset} from "./types.js";

export const particleFilterResolution=8;

const vertex=`precision highp float;
attribute vec2 position;
varying vec2 vUV;
void main(){vUV=position*.5+.5;gl_Position=vec4(position,0.0,1.0);}`;
const fragment=(reach:number)=>`precision highp float;
uniform sampler2D sourceTex;
uniform vec2 sourceSize,cellSize,gridSize;
uniform float sourcePadding,padding,radius;
varying vec2 vUV;
void main(){
  vec2 expanded=cellSize+2.0*padding,at=vUV*gridSize*expanded;
  vec2 tile=floor(at/expanded),p=at-tile*expanded-padding,base=floor(p);
  vec2 origin=tile*(cellSize+2.0*sourcePadding)+sourcePadding;
  vec4 largest=vec4(0.0);
  // Max of premultiplied channels matches SVG rectangular morphology. Work on
  // each isolated atlas cell, including transparent space outside its bounds.
  for(int y=-${reach};y<=${reach};y++)for(int x=-${reach};x<=${reach};x++){
    vec2 q=base+vec2(float(x),float(y));
    if(any(lessThan(q,vec2(0.0)))||any(greaterThanEqual(q,cellSize)))continue;
    if(any(greaterThanEqual(q,p+radius))||any(lessThanEqual(q+1.0,p-radius)))continue;
    vec4 s=texture2D(sourceTex,(origin+q+.5)/sourceSize);
    largest=max(largest,vec4(s.rgb*s.a,s.a));
  }
  gl_FragColor=largest;
}`;

const blurFragment=`precision highp float;
uniform sampler2D sourceTex;
uniform vec2 sigma;
varying vec2 vUV;
void main(){
  vec4 sum=vec4(0.0);float weights=0.0;
  for(int i=-12;i<=12;i++){float x=float(i)*.25,w=exp(-.5*x*x);sum+=texture2D(sourceTex,vUV+sigma*x)*w;weights+=w;}
  gl_FragColor=sum/weights;
}`;

/** Small GPU working textures shared by all instances of an emitter. Only
 * artwork, dilation or softness edits rerender them; motion and gain do not. */
export class BabylonParticleFilter {
  texture?:Babylon.RenderTargetTexture;
  renderCount=0;
  private readonly pass:Babylon.EffectRenderer;
  private effect?:Babylon.EffectWrapper;
  private blur?:Babylon.EffectWrapper;
  private scratch?:Babylon.RenderTargetTexture;
  private reach=-1;private key="";private revision=0;private disposed=false;
  private pending:Promise<void>=Promise.resolve();
  private last?:{asset:SpriteAsset;source:Babylon.RawTexture;radius:number;softness:number};
  private readonly restored:Babylon.Observer<Babylon.AbstractEngine>;
  constructor(private readonly renderer:BabylonRenderer,private readonly id:string){
    this.pass=new renderer.B.EffectRenderer(renderer.engine);
    this.restored=renderer.engine.onContextRestoredObservable.add(()=>{
      this.key="";const input=this.last;
      if(input)void this.update(input.asset,input.source,input.radius,input.softness).then(()=>{if(!this.disposed)renderer.render();});
    });
  }
  update(asset:SpriteAsset,source:Babylon.RawTexture,radius:number,softness:number):Promise<void>{
    this.last={asset,source,radius,softness};
    const key=JSON.stringify([source.uniqueId,asset.size,asset.atlas,radius,softness]);
    if(key===this.key)return this.pending;
    this.key=key;const revision=++this.revision;
    this.pending=this.pending.then(async()=>{
      if(this.disposed||revision!==this.revision)return;
      const r=this.renderer,B=r.B,cell=asset.atlas?.cellSize||asset.size,padding=Math.ceil(radius+4*softness)+1;
      const columns=asset.atlas?.columns||1,rows=asset.atlas?.rows||1;
      // Eight samples per native pixel retain fractional outline edits while
      // keeping this pass independent of viewport resolution and particle count.
      const width=(cell.x+2*padding)*columns*particleFilterResolution,height=(cell.y+2*padding)*rows*particleFilterResolution;
      const size=this.texture?.getSize();
      if(!size||size.width!==width||size.height!==height){
        this.texture?.dispose();this.scratch?.dispose();this.scratch=undefined;
        this.texture=new B.RenderTargetTexture(`${this.id}/particle-filter`,{width,height},r.scene,{generateMipMaps:false,generateDepthBuffer:false,samplingMode:B.Texture.BILINEAR_SAMPLINGMODE,gammaSpace:false});
        this.texture.wrapU=this.texture.wrapV=B.Texture.CLAMP_ADDRESSMODE;
      }
      const reach=Math.ceil(radius);
      if(this.reach!==reach){
        this.effect?.dispose();this.reach=reach;
        this.effect=new B.EffectWrapper({engine:r.engine,name:`${this.id}/dilation`,vertexShader:vertex,fragmentShader:fragment(reach),attributeNames:["position"],uniformNames:["sourceSize","cellSize","gridSize","sourcePadding","padding","radius"],samplerNames:["sourceTex"]});
      }
      const wrapper=this.effect!;await wrapper.effect.whenCompiledAsync();
      if(this.disposed||revision!==this.revision)return;
      if(softness>0){
        if(!this.scratch){this.scratch=new B.RenderTargetTexture(`${this.id}/particle-filter-scratch`,{width,height},r.scene,{generateMipMaps:false,generateDepthBuffer:false,samplingMode:B.Texture.BILINEAR_SAMPLINGMODE,gammaSpace:false});this.scratch.wrapU=this.scratch.wrapV=B.Texture.CLAMP_ADDRESSMODE;}
        this.blur??=new B.EffectWrapper({engine:r.engine,name:`${this.id}/softness`,vertexShader:vertex,fragmentShader:blurFragment,attributeNames:["position"],uniformNames:["sigma"],samplerNames:["sourceTex"]});
        await this.blur.effect.whenCompiledAsync();if(this.disposed||revision!==this.revision)return;
      }
      wrapper.onApplyObservable.clear();wrapper.onApplyObservable.add(()=>{
        const effect=wrapper.effect;effect.setTexture("sourceTex",source);
        effect.setFloat2("sourceSize",asset.size.x,asset.size.y);effect.setFloat2("cellSize",cell.x,cell.y);effect.setFloat2("gridSize",columns,rows);
        effect.setFloat("sourcePadding",asset.atlas?.padding||0);effect.setFloat("padding",padding);effect.setFloat("radius",radius);
      });
      const alpha=r.engine.getAlphaMode();r.engine.setAlphaMode(B.Engine.ALPHA_DISABLE);
      try{
        this.pass.render(wrapper,this.texture);
        if(softness>0){
          const blur=this.blur!;blur.onApplyObservable.clear();blur.onApplyObservable.add(()=>{blur.effect.setTexture("sourceTex",this.texture!);blur.effect.setFloat2("sigma",softness*particleFilterResolution/width,0);});
          this.pass.render(blur,this.scratch);
          blur.onApplyObservable.clear();blur.onApplyObservable.add(()=>{blur.effect.setTexture("sourceTex",this.scratch!);blur.effect.setFloat2("sigma",0,softness*particleFilterResolution/height);});
          this.pass.render(blur,this.texture);
        }
        this.renderCount++;
      }finally{r.engine.setAlphaMode(alpha);}
    });
    return this.pending;
  }
  dispose():void {
    this.disposed=true;this.revision++;this.renderer.engine.onContextRestoredObservable.remove(this.restored);
    this.texture?.dispose();this.scratch?.dispose();this.effect?.dispose();this.blur?.dispose();this.pass.dispose();
  }
}
