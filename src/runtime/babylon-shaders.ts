/* Backend shaders operate on objects or the active camera, never a fixed frame. */
export function installShaders(B:typeof import("./babylon-library.js").B) {
    B.Effect.ShadersStore.sceneNumberFragmentShader=`
      precision highp float;varying vec2 localPoint;uniform sampler2D glyphTex;
      uniform vec4 tint;uniform vec2 cell,atlasSize,period;uniform float units,columns,padding,textLeft,repeated,sigma,gain;
      uniform int glyphCount;uniform float glyphFrames[32],glyphStarts[32];
      vec4 sampleText(vec2 p){
        p.x-=textLeft;if(repeated>.5)p=mod(p,period);
        if(p.y<0.0||p.y>=cell.y)return vec4(0.0);
        vec4 result=vec4(0.0);
        for(int i=0;i<32;i++){
          if(i>=glyphCount)break;
          float x=p.x-glyphStarts[i];if(x<0.0||x>=cell.x)continue;
          float frame=glyphFrames[i];vec2 start=vec2(mod(frame,columns),floor(frame/columns))*(cell+2.0*padding)+padding;
          vec4 t=texture2D(glyphTex,(start+floor(vec2(x,p.y))+.5)/atlasSize);
          result=vec4(mix(result.rgb,t.rgb,t.a),t.a+result.a*(1.0-t.a));
        }return result;
      }
      void main(){
        vec2 p=vec2(localPoint.x,-localPoint.y)*units;vec4 body=sampleText(p),halo=vec4(0.0);float weight=0.0;
        if(sigma>0.0&&gain>0.0){for(int y=-3;y<=3;y++)for(int x=-3;x<=3;x++){
          vec2 d=vec2(float(x),float(y));float w=exp(-.5*dot(d,d));vec4 t=sampleText(p+d*sigma);halo+=vec4(t.rgb*t.a,t.a)*w;weight+=w;
        }halo/=weight;halo.a=clamp(halo.a*gain,0.0,1.0);}
        float alpha=body.a+halo.a*(1.0-body.a);vec3 rgb=(body.rgb*body.a+(halo.a>0.0?halo.rgb*gain:vec3(0.0))*(1.0-body.a))/max(alpha,.000001);
        gl_FragColor=vec4(rgb*tint.rgb,alpha*tint.a);
      }`;
    B.Effect.ShadersStore.sceneEntityVertexShader=`
      precision highp float;
      attribute vec3 position;attribute vec2 uv;
      uniform mat4 worldViewProjection;
      varying vec2 textureUV;varying vec2 localPoint;
      void main(){textureUV=vec2(uv.x,1.0-uv.y);localPoint=position.xy;gl_Position=worldViewProjection*vec4(position,1.0);}`;
    B.Effect.ShadersStore.sceneBackgroundFragmentShader=`
      precision highp float;
      varying vec2 localPoint;
      uniform sampler2D backgroundTex,haloTex,noiseTex;
      uniform vec2 tileOrigin,tileSize,noiseOrigin,noiseSize,blurDirection;
      uniform float noiseRange,noiseEnabled,verticalWrap,saturation,directionalSigma;
      uniform vec3 noiseChannelGain;
      uniform vec4 tint;
      uniform vec4 clipBounds;uniform vec2 cropSigma;uniform float clipEnabled,glowSigma,glowGain;
      float cdf(float x){float a=abs(x)*.70710678118,t=1.0/(1.0+.3275911*a);float e=1.0-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*exp(-a*a);return .5+.5*sign(x)*e;}
      float crop(vec2 p,vec2 sigma){vec2 s=max(sigma,vec2(.000001));return (cdf((clipBounds.z-p.x)/s.x)-cdf((clipBounds.x-p.x)/s.x))*(cdf((clipBounds.w-p.y)/s.y)-cdf((clipBounds.y-p.y)/s.y));}
      bool outsideTile(vec2 uv){return ((verticalWrap==1.0||verticalWrap==2.0||verticalWrap==4.0)&&uv.y<0.0)||(verticalWrap==2.0&&uv.y>=1.0);}
      vec4 tileSample(vec2 p){
        vec2 uv=vec2(p.x-tileOrigin.x,tileOrigin.y-p.y)/tileSize;
        if(outsideTile(uv))return vec4(0.0);
        vec4 t=texture2D(backgroundTex,uv);return vec4(t.rgb*t.a,t.a);
      }
      void main(){
        vec2 tileUV=vec2(localPoint.x-tileOrigin.x,tileOrigin.y-localPoint.y)/tileSize;
        if(directionalSigma<=0.0&&outsideTile(tileUV)&&!(clipEnabled>.5&&glowSigma>0.0))discard;
        vec2 noiseUV=vec2(localPoint.x-noiseOrigin.x,noiseOrigin.y-localPoint.y)/noiseSize;
        vec4 texel=texture2D(backgroundTex,tileUV);
        if(directionalSigma>0.0){
          vec4 sum=vec4(0.0);float weights=0.0;
          for(int i=-12;i<=12;i++){float x=float(i)*0.25,w=exp(-0.5*x*x);sum+=tileSample(localPoint+blurDirection*(directionalSigma*x))*w;weights+=w;}
          texel=vec4(sum.rgb/max(sum.a,0.000001),sum.a/weights);
        }
        if(glowSigma>0.0&&glowGain>0.0){
          float bodyAlpha=texel.a*(clipEnabled>.5?crop(localPoint,cropSigma):1.0);
          vec4 halo=texture2D(haloTex,tileUV);
          vec2 combined=sqrt(cropSigma*cropSigma+vec2(glowSigma*glowSigma));
          float haloAlpha=clamp(halo.a*glowGain,0.0,1.0)*(clipEnabled>.5?crop(localPoint,combined):1.0);
          float alpha=bodyAlpha+haloAlpha*(1.0-bodyAlpha);
          texel=vec4((texel.rgb*bodyAlpha+halo.rgb*haloAlpha*(1.0-bodyAlpha))/max(alpha,.000001),alpha);
        }else if(clipEnabled>.5)texel.a*=crop(localPoint,cropSigma);
        float luma=dot(texel.rgb,vec3(.213,.715,.072));
        vec3 color=clamp((vec3(luma)+saturation*(texel.rgb-vec3(luma)))*tint.rgb,0.0,1.0);
        float grain=(texture2D(noiseTex,noiseUV).r*2.0-1.0)*noiseRange;
        gl_FragColor=vec4(color*exp(grain*noiseEnabled*noiseChannelGain),texel.a*tint.a);
      }`;
    B.Effect.ShadersStore.sceneSolidFragmentShader=`precision highp float;
      varying vec2 localPoint;uniform vec4 tint;uniform vec2 gridSize,gridOrigin,gridDirection;uniform float gridFront,gridFeather,transitionKind,transitionProgress,dissolveSeed;uniform float pinwheelFronts[64];
      #ifdef PLANE_NOISE
      uniform float ellipse,ellipseAA;uniform vec2 ellipseSize;
      uniform sampler2D noiseTex;uniform vec2 noiseOrigin,noiseSize;uniform float noiseRange,noiseEnabled;uniform vec3 noiseChannelGain;
      #endif
      float dissolveThreshold(vec2 cell){
        vec2 p=mod(cell,4093.0);float s=dissolveSeed;
        float n=mod(p.x*53.0+p.y*97.0+s,4093.0);n=mod(n*(n+1.0),4093.0);
        n=mod(n*109.0+s*37.0+p.x*17.0,4093.0);n=mod(n*(n+1.0),4093.0);
        return (mod(n*173.0+p.y*71.0+s*13.0,4093.0)+.5)/4093.0;
      }
      void main(){
        if(transitionKind>0.5&&transitionProgress<=0.0)discard;
        if(transitionKind==1.0&&transitionProgress<1.0){
          vec2 cell=floor((localPoint-gridOrigin)/gridSize),center=gridOrigin+(cell+.5)*gridSize;
          float size=(gridFront-dot(localPoint,gridDirection))/gridFeather;
          vec2 p=abs(localPoint-center)/gridSize;
          if(size<=0.0||max(p.x,p.y)>=size*.5)discard;
        }
        if(transitionKind==2.0&&transitionProgress<1.0){
          vec2 cell=floor((localPoint-gridOrigin)/gridSize);float u,v;int q;
          if(cell.x>=0.0&&cell.y>=0.0){q=0;u=cell.x;v=cell.y;}
          else if(cell.x<0.0&&cell.y>=0.0){q=1;u=cell.y;v=-cell.x-1.0;}
          else if(cell.x<0.0&&cell.y<0.0){q=2;u=-cell.x-1.0;v=-cell.y-1.0;}
          else{q=3;u=-cell.y-1.0;v=cell.x;}
          int index=q*16+int(min(u,15.0));float front=pinwheelFronts[index];
          if(u>15.0)front+=(u-15.0)*max(0.0,pinwheelFronts[q*16+15]-pinwheelFronts[q*16+14]);
          if(v>=front)discard;
        }
        if(transitionKind==3.0&&transitionProgress<1.0){
          vec2 cell=floor((localPoint-gridOrigin)/gridSize);float n=dissolveThreshold(cell);
          if(length(gridDirection)>.5){if(dot(gridOrigin+(cell+.5)*gridSize,gridDirection)+n*gridFeather>=gridFront)discard;}
          else if(n>=transitionProgress)discard;
        }
        if(transitionKind==4.0&&transitionProgress<1.0&&mod(dot(localPoint,gridDirection)-gridFront,gridFeather)>=gridFeather*transitionProgress)discard;
        gl_FragColor=tint;
        #ifdef PLANE_NOISE
        if(ellipse>.5)gl_FragColor.a*=1.0-smoothstep(1.0-ellipseAA,1.0+ellipseAA,length(localPoint*2.0/ellipseSize));
        if(noiseEnabled>.5){
          vec2 noiseUV=vec2(localPoint.x-noiseOrigin.x,noiseOrigin.y-localPoint.y)/noiseSize;
          float grain=(texture2D(noiseTex,noiseUV).r*2.0-1.0)*noiseRange;
          gl_FragColor.rgb=clamp(tint.rgb*exp(grain*noiseChannelGain),0.0,1.0);
        }
        #endif
      }`;
    B.Effect.ShadersStore.sceneVignettePlaneFragmentShader=`
      precision highp float;varying vec2 localPoint;uniform vec2 halfSize,center;uniform vec3 shape;
      void main(){vec2 uv=localPoint/(2.0*halfSize)+0.5,d=(uv-center)*vec2(2.0,2.0*shape.z);float r2=dot(d,d);gl_FragColor=vec4(0.0,0.0,0.0,1.0-exp(-shape.x*r2-shape.y*r2*r2));}`;
    B.Effect.ShadersStore.sceneLineFragmentShader=`
      precision highp float;varying vec2 localPoint;
      uniform vec2 lineStart,lineEnd;uniform vec4 tint;uniform float halfWidth,sigma,gain,pixelWidth;
      float normalCDF(float x){float a=abs(x)*0.7071067811865476,t=1.0/(1.0+0.3275911*a);float e=1.0-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*exp(-a*a);return 0.5+0.5*sign(x)*e;}
      void main(){vec2 delta=lineEnd-lineStart;float len=length(delta);vec2 direction=delta/max(len,0.000001),p=localPoint-lineStart;float along=dot(p,direction),across=abs(p.x*direction.y-p.y*direction.x),alpha;
        if(sigma>0.000001){alpha=(normalCDF((halfWidth-across)/sigma)-normalCDF((-halfWidth-across)/sigma))*(normalCDF(along/sigma)-normalCDF((along-len)/sigma));}
        else{float aa=max(pixelWidth*0.5,0.000001);alpha=(1.0-smoothstep(halfWidth-aa,halfWidth+aa,across))*smoothstep(-aa,aa,along)*(1.0-smoothstep(len-aa,len+aa,along));}
        gl_FragColor=vec4(tint.rgb,tint.a*alpha*gain);
      }`;
    B.Effect.ShadersStore.sceneSpriteFragmentShader=`
      precision highp float;
      varying vec2 textureUV,localPoint;
      uniform sampler2D spriteTex,noiseTex,filteredTex;
      uniform vec2 noiseOrigin,noiseSize;
      uniform vec4 tint,uvRect,uvBounds;
      uniform float maskOnly,intensity,hue,noiseRange,noiseEnabled,saturation,brightness,whiteMix;
      uniform float opacityGradientEnabled;uniform vec2 opacityGradientStart,opacityGradientEnd;
      uniform vec3 noiseChannelGain;
      vec3 rotateHue(vec3 c){
        float co=cos(hue),si=sin(hue);
        return vec3(dot(c,vec3(.213+.787*co-.213*si,.715-.715*co-.715*si,.072-.072*co+.928*si)),
          dot(c,vec3(.213-.213*co+.143*si,.715+.285*co+.140*si,.072-.072*co-.283*si)),
          dot(c,vec3(.213-.213*co-.787*si,.715-.715*co+.715*si,.072+.928*co+.072*si)));
      }
      uniform float motionEnabled,motionAmount,motionGain,filterPadding,filterFrame;uniform int motionCount;uniform vec4 motionArt;uniform vec2 motionCenter,motionOffset,filterCell,filterGrid;
      vec4 sampleArt(vec2 p){
        vec2 uv=(p-motionArt.xy)/motionArt.zw;uv.y=1.0-uv.y;
        if(filterPadding>0.0){
          vec2 expanded=filterCell+2.0*filterPadding,at=filterPadding+uv*filterCell;
          if(any(lessThan(at,vec2(0.0)))||any(greaterThan(at,expanded)))return vec4(0.0);
          vec2 tile=vec2(mod(filterFrame,filterGrid.x),floor(filterFrame/filterGrid.x));
          vec4 s=texture2D(filteredTex,(tile*expanded+at)/(expanded*filterGrid));
          return vec4(s.rgb/max(s.a,.000001),s.a);
        }
        if(min(uv.x,uv.y)<0.0||max(uv.x,uv.y)>1.0)return vec4(0.0);
        return texture2D(spriteTex,clamp(uvRect.xy+uv*uvRect.zw,uvBounds.xy,uvBounds.zw));
      }
      void main(){vec2 uv=clamp(uvRect.xy+textureUV*uvRect.zw,uvBounds.xy,uvBounds.zw);vec4 t=texture2D(spriteTex,uv);
        if(motionEnabled>.5){vec4 sum=vec4(0.0);float total=0.0;for(int i=0;i<33;i++){if(i>=motionCount)break;float phase=2.0*float(i)/float(motionCount-1)-1.0,w=exp(-2.0*phase*phase);vec2 p=motionCenter+(localPoint-motionCenter-motionOffset*phase)/(1.0+phase*motionAmount);vec4 s=sampleArt(p);sum+=vec4(s.rgb*s.a,s.a)*w;total+=w;}t=vec4(sum.rgb/max(sum.a,.000001),sum.a/total);}
        else if(filterPadding>0.0)t=sampleArt(localPoint);
        t.a=clamp(t.a*motionGain,0.0,1.0);
        vec3 color=mix(t.rgb,vec3(1.0),max(maskOnly,whiteMix))*tint.rgb;
        vec2 noiseUV=vec2(localPoint.x-noiseOrigin.x,noiseOrigin.y-localPoint.y)/noiseSize;
        float grain=(texture2D(noiseTex,noiseUV).r*2.0-1.0)*noiseRange;
        color=clamp(rotateHue(color),0.0,1.0);if(saturation!=1.0||brightness!=1.0){float luma=dot(color,vec3(.213,.715,.072));color=clamp(clamp(vec3(luma)+(color-vec3(luma))*saturation,0.0,1.0)*brightness,0.0,1.0);}
        vec2 ramp=opacityGradientEnd-opacityGradientStart;
        float opacity=mix(1.0,clamp(dot(localPoint-opacityGradientStart,ramp)/max(dot(ramp,ramp),1e-18),0.0,1.0),opacityGradientEnabled);
        gl_FragColor=vec4(clamp(color*exp(grain*noiseEnabled*noiseChannelGain),0.0,1.0),mix(t.a,t.r,maskOnly)*tint.a*intensity*opacity);}`;
    B.Effect.ShadersStore.sceneVignetteFragmentShader=`
      precision highp float;varying vec2 vUV;uniform sampler2D textureSampler;
      uniform vec2 center;uniform vec3 shape;uniform float enabled;
      void main(){vec2 d=(vUV-center)*vec2(2.0,2.0*shape.z);float r2=dot(d,d);
        vec4 c=texture2D(textureSampler,vUV);gl_FragColor=vec4(c.rgb*exp((-shape.x*r2-shape.y*r2*r2)*enabled),1.0);}`;
    B.Effect.ShadersStore.sceneViewportFrameFragmentShader=`
      precision highp float;varying vec2 vUV;uniform sampler2D textureSampler;
      uniform vec2 viewportSize,shadowOffset;uniform vec4 aperture,borderColor,shadowColor;uniform float radius,deviceScale;
      float coverage(vec2 p){
        if(aperture.z<=0.0||aperture.w<=0.0)return 0.0;
        vec2 q=abs(p-aperture.xy-aperture.zw*.5)-aperture.zw*.5+radius;
        float d=length(max(q,0.0))+min(max(q.x,q.y),0.0)-radius;
        return clamp(.5-d*deviceScale,0.0,1.0);
      }
      void main(){
        vec2 p=vec2(vUV.x,1.0-vUV.y)*viewportSize;
        float outer=coverage(p),inner=coverage(p-shadowOffset);
        vec4 source=texture2D(textureSampler,vUV);
        vec3 shadowed=mix(source.rgb,shadowColor.rgb,shadowColor.a*(1.0-inner));
        vec3 outside=mix(source.rgb,borderColor.rgb,borderColor.a);
        gl_FragColor=vec4(mix(outside,shadowed,outer),source.a);
      }`;
}
