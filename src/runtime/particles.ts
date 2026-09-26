/* Shared analytic particle state. Renderers never own a random stream or clock. */
import { Math3D as M } from "./math.js";
import { spriteRect } from "./atlas.js";
import {Frame,Time,frameRate,type FrameTime} from "./animation/time.js";
import type { Scene } from "./scene.js";
import type { Vec3, Color, Key, Range, View, ParticleEmitter, ParticleState, SpriteAsset } from "./types.js";
type Random = () => number;
const axes = ["x", "y", "z"] as const;

export function mulberry32(seed:number):Random{
  let state=seed>>>0;
  return ()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
function hash(seed:number,id:number,salt=0){let x=(seed^Math.imul(id,0x9E3779B1)^salt)>>>0;x=Math.imul(x^(x>>>16),0x85EBCA6B);x=Math.imul(x^(x>>>13),0xC2B2AE35);return (x^(x>>>16))>>>0;}
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
export function sampleKeys<T extends number|Vec3|Color>(keys:Key<T>[]|undefined,time:number,fallback:T):T{
  if(!keys?.length)return fallback;
  if(time<=keys[0].time)return keys[0].value;
  for(let i=1;i<keys.length;i++)if(time<keys[i].time){
    const a=keys[i-1],b=keys[i],u=a.interpolation==="step"?0:(time-a.time)/(b.time-a.time);
    if(typeof a.value==="number"&&typeof b.value==="number")return lerp(a.value,b.value,u) as T;
    if(typeof a.value!=="number"&&typeof b.value!=="number"){
      const first=a.value as Vec3|Color,last=b.value as Vec3|Color;
      if("x" in first&&"x" in last)return {x:lerp(first.x,last.x,u),y:lerp(first.y,last.y,u),z:lerp(first.z,last.z,u)} as T;
      if("r" in first&&"r" in last)return {r:lerp(first.r,last.r,u),g:lerp(first.g,last.g,u),b:lerp(first.b,last.b,u),a:lerp(first.a,last.a,u)} as T;
    }
    throw new Error("Keyframe values must have matching types.");
  }
  return keys[keys.length-1].value;
}
const length=(v:Vec3)=>Math.hypot(v.x,v.y,v.z);
// Exact area under a step/linear velocity curve. No frame integration or
// mutable simulation history, so seeking and reverse playback stay identical.
function integratedSpeed(keys:Key<number>[],u:number):number{
  if(!keys.length)return u;
  let total=Math.min(u,keys[0].time)*keys[0].value;
  for(let i=1;i<keys.length&&u>keys[i-1].time;i++){
    const a=keys[i-1],b=keys[i],span=b.time-a.time,t=Math.min(u,b.time)-a.time;
    total+=a.value*t+(a.interpolation==="step"?0:(b.value-a.value)*t*t/(2*span));
  }
  const last=keys[keys.length-1];return total+Math.max(0,u-last.time)*last.value;
}
const normalized=(v:Vec3)=>{const n=length(v)||1;return {x:v.x/n,y:v.y/n,z:v.z/n};};
const cross=(a:Vec3,b:Vec3)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const range=(r:Range,random:Random)=>lerp(r.min,r.max,random());
const white:Color={r:1,g:1,b:1,a:1};
function paletteColor(c:ParticleEmitter,birth:{id:number;salt:number},total:number):Color{
  if(!c.colorPalette.length)return white;
  // A separate birth stream keeps geometry and atlas phases unchanged when
  // the palette is edited. A color is selected once for the particle's life.
  let value=mulberry32(hash(c.seed,birth.id,birth.salt^0x68E31DA4))()*total;
  for(const entry of c.colorPalette){value-=entry.weight;if(value<0)return entry.color;}
  return c.colorPalette[c.colorPalette.length-1].color;
}
function unitSphere(random:Random){const z=2*random()-1,a=2*Math.PI*random(),r=Math.sqrt(1-z*z);return {x:r*Math.cos(a),y:r*Math.sin(a),z};}
function shapePoint(shape:ParticleEmitter["shape"],random:Random):Vec3{
  const s=shape.size;
  if(shape.type==="box")return {x:(random()-.5)*s.x,y:(random()-.5)*s.y,z:(random()-.5)*s.z};
  if(shape.type==="ellipse"){const a=2*Math.PI*random(),inner=shape.innerRadiusRatio**2,r=Math.sqrt(inner+(1-inner)*random());return {x:Math.cos(a)*r*s.x/2,y:Math.sin(a)*r*s.y/2,z:0};}
  if(shape.type==="sphere"){const p=unitSphere(random),r=Math.cbrt(random());return {x:p.x*r*s.x/2,y:p.y*r*s.y/2,z:p.z*r*s.z/2};}
  return {x:0,y:0,z:0};
}
function direction(c:ParticleEmitter,point:Vec3,random:Random):Vec3{
  if(c.directionMode==="radial")return length(point)>1e-9?normalized(point):unitSphere(random);
  if(c.directionMode==="planar"){
    const angle=Math.atan2(c.direction.y,c.direction.x)+(random()*2-1)*c.spreadDegrees*Math.PI/180;
    return {x:Math.cos(angle),y:Math.sin(angle),z:0};
  }
  const d=normalized(c.direction),u=normalized(cross(Math.abs(d.z)<.9?{x:0,y:0,z:1}:{x:0,y:1,z:0},d)),v=cross(d,u);
  const co=lerp(Math.cos(c.spreadDegrees*Math.PI/180),1,random()),si=Math.sqrt(Math.max(0,1-co*co)),angle=2*Math.PI*random();
  const result={x:0,y:0,z:0};for(const k of axes)result[k]=d[k]*co+si*(u[k]*Math.cos(angle)+v[k]*Math.sin(angle));return result;
}
function frameAt(c:ParticleEmitter,asset:SpriteAsset,time:FrameTime,u:number,random:Random){
  const a=c.animation,frames=a.frames.length?a.frames:Array.from({length:asset.atlas?.frameCount||1},(_,i)=>i),offset=a.randomStart?Math.floor(random()*frames.length):0;
  const i=a.mode==="random"?Math.floor(random()*frames.length):a.mode==="lifetime"?Math.min(frames.length-1,Math.floor(u*frames.length)):a.mode==="fps"?Time.floor(Time.scale(time,Time.decimal(a.framesPerSecond)))+offset:a.frame;
  return a.mode==="single"?a.frame:frames[a.mode==="fps"&&a.loop?((i%frames.length)+frames.length)%frames.length:Math.max(0,Math.min(frames.length-1,i))];
}
export function particleStates(scene:Scene,id:string,time:FrameTime|number=scene.timelineTime,view?:Pick<View,"worldWidth"|"worldHeight">):ParticleState[]{
  const c=scene.component(id,"ParticleEmitter");
  if(!c?.enabled||!scene.active.get(id))return [];
  const sceneTime=typeof time==="number"?Time.fromDecimal(time):time,start=Time.convert(Time.fromFrame(c.start.frame),c.start.rate,frameRate(1)),now=Time.subtract(sceneTime,start);
  if(now.frame<0&&!c.cameraContinuation)return [];
  const asset=scene.asset(c.asset),cell=asset.atlas?.cellSize||asset.size,spawns:{id:number;offset:FrameTime;salt:number;sizeScale?:number;color?:Color;velocity?:Vec3;targetVelocity?:Vec3}[]=[];
  // Continue planar streams through the live frustum. The
  // authored birth is still the reference point for IDs, motion and curves:
  // resizing only reveals earlier/later portions of the same trajectories.
  // Beyond the authored lifetime, use its endpoint velocity and clamp curves.
  let earliestAge=0,latestAge=c.lifetime.max;
  let bounds:ReturnType<Scene["coverage"]>=null;
  if(c.cameraContinuation){
    const camera=scene.requireComponent(scene.cameraNode.id,"Camera"),glow=scene.component(id,"Glow"),blur=scene.component(id,"ParticleMotionBlur");
    const maxSize=c.startSize.max*Math.max(1,...c.sizeOverLife.map(k=>k.value))*Math.max(1,...c.bursts.map(b=>b.sizeScale??1));
    const radius=maxSize*Math.hypot(cell.x/cell.y,1)/2;
    const glowRadius=glow?.enabled?4*glow.sigmaWorld*asset.pixelsPerUnit*maxSize/cell.y:0;
    const blurRadius=blur?.enabled?4*blur.maxSigmaWorld+(blur.dilationPixels+4*blur.softnessPixels)*maxSize/cell.y:0;
    const padding=c.cameraContinuation.padding+radius+glowRadius+blurRadius;
    bounds=scene.coverage(id,view||{worldWidth:camera.referenceVerticalSize*camera.referenceAspect,worldHeight:camera.referenceVerticalSize},padding);
    if(!bounds)return [];
    const d=normalized(c.direction),support=(Math.abs(d.x)*c.shape.size.x+Math.abs(d.y)*c.shape.size.y)/2;
    const a=d.x*(d.x<0?bounds.right:bounds.left)+d.y*(d.y<0?bounds.top:bounds.bottom)-support;
    const b=d.x*(d.x<0?bounds.left:bounds.right)+d.y*(d.y<0?bounds.bottom:bounds.top)+support;
    earliestAge=Math.min(0,a/c.speed.min);latestAge=Math.max(latestAge,b/c.speed.min);
  }
  if(c.rate>0){
    const exactRate=Number.isSafeInteger(c.rate)?Time.rational(c.rate):null;
    const offset=(n:number)=>exactRate?Time.fromRatio(n,c.rate):Time.fromDecimal(n/c.rate);
    const indexAt=(time:FrameTime,ceil:boolean):number=>{
      if(exactRate){const phase=Time.scale(time,exactRate);return ceil?Time.ceil(phase):Time.floor(phase);}
      // Fitted densities are floating parameters. Sample each birth directly
      // from its integer index, at the same nanosecond ingress as other seconds.
      // Compare against that birth to settle boundaries instead of carrying a
      // huge fraction made from all digits of a fitted floating-point rate.
      let n=Math.floor(Time.toDecimal(time)*c.rate);
      if(Time.compare(offset(n),time)>0)n--;
      else if(Time.compare(offset(n+1),time)<=0)n++;
      return ceil&&Time.compare(offset(n),time)<0?n+1:n;
    };
    const prewarm=Time.fromDecimal(-c.prewarm),oldest=Time.subtract(now,Time.fromDecimal(latestAge)),newest=Time.subtract(now,Time.fromDecimal(earliestAge));
    const first=indexAt(Time.compare(prewarm,oldest)>0?prewarm:oldest,true),last=Math.min(indexAt(newest,false),c.duration>0?indexAt(Time.fromDecimal(c.duration),true)-1:Infinity);
    for(let n=last;n>=first;n--){spawns.push({id:n,offset:offset(n),salt:0});if(!bounds&&spawns.length>=c.maxParticles+Math.ceil(c.rate*(c.lifetime.max-c.lifetime.min)))break;}
  }
  c.bursts.forEach((burst,index)=>{const offset=typeof burst.time==="number"?Time.fromDecimal(burst.time):Time.convert(Time.fromFrame(burst.time.frame),burst.time.rate,frameRate(1)),age=Time.subtract(now,offset);if(Time.compare(age,Time.fromDecimal(earliestAge))>=0&&Time.compare(age,Time.fromDecimal(latestAge))<0)for(let n=0;n<burst.count;n++)spawns.push({id:n,offset,salt:hash(0,index,0xB5297A4D),sizeScale:burst.sizeScale,color:burst.color,velocity:burst.velocity,targetVelocity:burst.targetVelocity});});
  spawns.sort((a,b)=>Time.compare(b.offset,a.offset)||a.salt-b.salt||b.id-a.id);
  const camera=scene.matrixAt(scene.cameraNode.id,sceneTime),inverseCamera=M.inverse(camera),current=scene.matrixAt(id,sceneTime),states:ParticleState[]=[];
  const perspective=scene.requireComponent(scene.cameraNode.id,"Camera").projection==="perspective",projectionDistance=perspective?scene.projectionDistance:1;
  const cameraRotation=M.identity();for(let col=0;col<3;col++){const n=Math.hypot(camera[col*4],camera[col*4+1],camera[col*4+2]);for(let row=0;row<3;row++)cameraRotation[col*4+row]=camera[col*4+row]/n;}
  const paletteWeight=c.colorPalette.reduce((sum,entry)=>sum+entry.weight,0),motionBlur=scene.component(id,"ParticleMotionBlur");
  for(const birth of spawns){
    const random=mulberry32(hash(c.seed,birth.id,birth.salt)),life=range(c.lifetime,random),ageTime=Time.subtract(now,birth.offset),age=Time.toDecimal(ageTime);
    if(!bounds&&(ageTime.frame<0||Time.compare(ageTime,Time.fromDecimal(life))>=0))continue;
    const u=Math.max(0,Math.min(1,age/life)),point=shapePoint(c.shape,random),d=direction(c,point,random),sampledSpeed=range(c.speed,random),birthSize=range(c.startSize,random);
    const sizeQuantile=c.startSize.max>c.startSize.min?(birthSize-c.startSize.min)/(c.startSize.max-c.startSize.min):.5;
    const speed=lerp(sampledSpeed,lerp(c.speed.min,c.speed.max,sizeQuantile),c.speedSizeCorrelation),size=birthSize*sampleKeys(c.sizeOverLife,u,1)*(birth.sizeScale??1);
    const accelerationTime=bounds?(age<0?0:age>life?life*(age-life/2):age*age/2):age*age/2;
    const velocityTime=bounds?Math.max(0,Math.min(life,age)):age;
    if(bounds){const x=point.x+d.x*speed*age+c.acceleration.x*accelerationTime,y=point.y+d.y*speed*age+c.acceleration.y*accelerationTime;if(x<bounds.left||x>bounds.right||y<bounds.bottom||y>bounds.top)continue;}
    const spin=(range(c.rotation,random)+range(c.angularVelocity,random)*age)*Math.PI/180,frame=frameAt(c,asset,c.animation.timeSource==="scene"?sceneTime:ageTime,u,random);
    const color=sampleKeys(c.colorOverLife,u,white),chosen=birth.color||paletteColor(c,birth,paletteWeight),tint={r:color.r*c.color.r*chosen.r,g:color.g*c.color.g*chosen.g,b:color.b*c.color.b*chosen.b,a:color.a*c.color.a*chosen.a};
    // Motion remains in the emitter's simulation coordinates. Local particles
    // use the current hierarchy, including particles born before it moved.
    // World matrices below are a rendering result, not persistent particle entities.
    const distance=c.speedOverLife.length?speed*life*integratedSpeed(c.speedOverLife,u):speed*age,speedNow=speed*sampleKeys(c.speedOverLife,u,1);
    const position={x:0,y:0,z:0},velocity={x:0,y:0,z:0};
    if(c.velocityRelaxation){
      // dv/dt = rate * (target - v). Evaluate the closed form at particle age;
      // no integration history is retained, even when the velocity reverses.
      const motion=c.velocityRelaxation,noise=mulberry32(hash(c.seed,birth.id,birth.salt^0x41C64E6D));
      for(const k of axes){
        const target=birth.targetVelocity?.[k]??motion.target[k]+(noise()-.5)*2*motion.variation[k],initial=birth.velocity?.[k]??d[k]*speed,decay=motion.rate[k];
        if(decay===0){position[k]=point[k]+initial*age+c.acceleration[k]*accelerationTime;velocity[k]=initial+c.acceleration[k]*velocityTime;continue;}
        const integral=-Math.expm1(-decay*age)/decay;
        position[k]=point[k]+target*age+(initial-target)*integral+c.acceleration[k]*accelerationTime;
        velocity[k]=target+(initial-target)*Math.exp(-decay*age)+c.acceleration[k]*velocityTime;
      }
    }else if(birth.velocity){
      const integral=c.speedOverLife.length?life*integratedSpeed(c.speedOverLife,u):age,gain=sampleKeys(c.speedOverLife,u,1);
      for(const k of axes){position[k]=point[k]+birth.velocity[k]*integral+c.acceleration[k]*accelerationTime;velocity[k]=birth.velocity[k]*gain+c.acceleration[k]*velocityTime;}
    }else for(const k of axes){position[k]=point[k]+d[k]*distance+c.acceleration[k]*accelerationTime;velocity[k]=d[k]*speedNow+c.acceleration[k]*velocityTime;}
    let expansion=1;
    if(c.radialExpansion){
      const rate=range(c.radialExpansion,mulberry32(hash(c.seed,birth.id,birth.salt^0x163C80A7)));
      expansion=Math.exp(rate*age);
      // Differentiate the same closed form used for positions so motion blur
      // follows the expanded trajectory, including any base velocity.
      for(const k of axes){velocity[k]=(velocity[k]+rate*position[k])*expansion;position[k]*=expansion;}
    }
    const birthTime=Time.add(start,birth.offset);
    const origin=c.space==="world"?scene.matrixAt(id,birthTime):current,worldPosition=M.point(origin,position),matrix=M.identity();
    const height=size*expansion,width=height*cell.x/cell.y,co=Math.cos(spin),si=Math.sin(spin);
    let basis=origin;
    if(c.billboard==="camera"){
      basis=cameraRotation;const sx=Math.hypot(origin[0],origin[1],origin[2]),sy=Math.hypot(origin[4],origin[5],origin[6]);
      for(let row=0;row<3;row++){matrix[row]=(basis[row]*co+basis[4+row]*si)*width*sx;matrix[4+row]=(-basis[row]*si+basis[4+row]*co)*height*sy;matrix[8+row]=basis[8+row];}
    }else for(let row=0;row<3;row++){matrix[row]=(basis[row]*co+basis[4+row]*si)*width;matrix[4+row]=(-basis[row]*si+basis[4+row]*co)*height;matrix[8+row]=basis[8+row];}
    const blurUV={x:0,y:0};
    if(motionBlur?.enabled&&motionBlur.shutterSeconds>0&&size>0){
      // Project velocity into the rendered sprite basis. Gaussian sigma has
      // the same variance as a uniform exposure of shutterSeconds duration.
      // Geometry is unchanged: only the filter footprint gets wider.
      const v=M.point(origin,velocity,0),dot=(a:number,b:number)=>matrix[a]*matrix[b]+matrix[a+1]*matrix[b+1]+matrix[a+2]*matrix[b+2];
      const aa=dot(0,0),ab=dot(0,4),bb=dot(4,4),det=aa*bb-ab*ab;
      if(det>1e-20){
        const av=matrix[0]*v.x+matrix[1]*v.y+matrix[2]*v.z,bv=matrix[4]*v.x+matrix[5]*v.y+matrix[6]*v.z;
        const x=(av*bb-bv*ab)/det,y=(bv*aa-av*ab)/det;
        const planar=Math.hypot(matrix[0]*x+matrix[4]*y,matrix[1]*x+matrix[5]*y,matrix[2]*x+matrix[6]*y);
        const exposure=Math.min(motionBlur.shutterSeconds/Math.sqrt(12),motionBlur.maxSigmaWorld/Math.max(planar,1e-12));
        blurUV.x=x*exposure||0;blurUV.y=-y*exposure||0;
      }
    }
    for(const [row,k] of axes.entries())matrix[12+row]=worldPosition[k]+matrix[row]*(.5-asset.pivot.x)+matrix[4+row]*(.5-asset.pivot.y);
    const rect=spriteRect(asset,frame);
    rect.x/=asset.size.x;rect.y/=asset.size.y;rect.width/=asset.size.x;rect.height/=asset.size.y;
    const screenX=M.point(inverseCamera,{x:matrix[0],y:matrix[1],z:matrix[2]},0),screenY=M.point(inverseCamera,{x:matrix[4],y:matrix[5],z:matrix[6]},0);
    const cameraPosition=M.point(inverseCamera,worldPosition);let projectedArea=Math.abs(screenX.x*screenY.y-screenX.y*screenY.x);
    if(perspective){
      const z=Math.max(cameraPosition.z,1e-8),scale=projectionDistance/z;
      const dx={x:(screenX.x-cameraPosition.x*screenX.z/z)*scale,y:(screenX.y-cameraPosition.y*screenX.z/z)*scale};
      const dy={x:(screenY.x-cameraPosition.x*screenY.z/z)*scale,y:(screenY.y-cameraPosition.y*screenY.z/z)*scale};
      projectedArea=Math.abs(dx.x*dy.y-dx.y*dy.x);
    }
    states.push({id:`${birth.salt}:${birth.id}`,birthTime:Time.toDecimal(birthTime),age,lifetime:life,frame,color:tint,matrix,rect,blurUV,localPosition:position,position:worldPosition,depth:cameraPosition.z,projectedArea});
    if(states.length>=c.maxParticles)break;
  }
  return states.sort((a,b)=>(c.sortMode==="sizeAscending"?a.projectedArea-b.projectedArea:b.depth-a.depth)||a.birthTime-b.birthTime||a.id.localeCompare(b.id));
}

export const particleDefaults:ParticleEmitter={asset:"",colorMatrix:[1,0,0,0,0,1,0,0,0,0,1,0],seed:1,maxParticles:256,start:{frame:Frame.zero,rate:frameRate(30)},duration:0,prewarm:0,rate:10,bursts:[],cameraContinuation:null,space:"local",shape:{type:"point",size:{x:0,y:0,z:0},innerRadiusRatio:0},directionMode:"cone",direction:{x:0,y:1,z:0},spreadDegrees:0,speed:{min:1,max:1},speedSizeCorrelation:0,speedOverLife:[],lifetime:{min:1,max:1},startSize:{min:.1,max:.1},rotation:{min:0,max:0},angularVelocity:{min:0,max:0},acceleration:{x:0,y:0,z:0},velocityRelaxation:null,radialExpansion:null,sizeOverLife:[],color:{r:1,g:1,b:1,a:1},colorPalette:[],colorOverLife:[],billboard:"camera",blend:"alpha",sortMode:"depth",animation:{mode:"single",timeSource:"age",frame:0,frames:[],framesPerSecond:15,loop:true,randomStart:false}};

export function validateKeys(keys:unknown,label:string,axes:string|null=null,unitTime=false,minimum=-Infinity){
  if(!Array.isArray(keys))throw new Error(`${label} must be a key array.`);
  let previous=-Infinity;
  for(const item of keys as unknown[]){
    if(!item||typeof item!=="object")throw new Error(`Invalid ${label} key.`);
    const key=item as Record<string,unknown>,time=key.time;
    if(typeof time!=="number"||!Number.isFinite(time)||time<0||(unitTime&&time>1)||time<=previous)throw new Error(`${label} needs increasing key times.`);
    previous=time;
    if(key.interpolation!==undefined&&key.interpolation!=="linear"&&key.interpolation!=="step")throw new Error(`Invalid ${label} interpolation.`);
    const value=key.value;
    const values=axes?[...axes].map(axis=>value&&typeof value==="object"?(value as Record<string,unknown>)[axis]:undefined):[value];
    if(values.some(v=>typeof v!=="number"||!Number.isFinite(v)||v<minimum))throw new Error(`Invalid ${label} values.`);
    if(axes==="rgba"&&values.some(v=>typeof v==="number"&&v>1))throw new Error(`${label} colors must be in [0, 1].`);
  }
}
export function validateEmitter(c:ParticleEmitter,assets:Record<string,SpriteAsset>){
  const fail=(m:string)=>{throw new Error(`ParticleEmitter: ${m}`);},number=(n:number,min:number,max=Infinity)=>Number.isFinite(n)&&n>=min&&n<=max;
  if(!Array.isArray(c.colorMatrix)||c.colorMatrix.length!==12||c.colorMatrix.some(v=>!Number.isFinite(v)))fail("colorMatrix must contain twelve finite values.");
  if(!Number.isInteger(c.seed)||!number(c.seed,0,4294967295))fail("seed must be an unsigned 32-bit integer.");
  if(!Number.isInteger(c.maxParticles)||!number(c.maxParticles,1,20000))fail("maxParticles must be an integer in [1, 20000].");
  for(const key of ["duration","prewarm","rate"] as const)if(!number(c[key],0))fail(`invalid ${key}.`);
  if(!number(c.spreadDegrees,0,180))fail("invalid cone angle.");
  if(!number(c.speedSizeCorrelation,0,1))fail("invalid speedSizeCorrelation.");
  for(const key of ["speed","lifetime","startSize","rotation","angularVelocity"] as const){const r=c[key],min=["speed","startSize"].includes(key)?0:key==="lifetime"?1e-5:-Infinity;if(!r||!number(r.min,min)||!number(r.max,r.min))fail(`invalid ${key} range.`);}
  if(!["local","world"].includes(c.space)||!["camera","local"].includes(c.billboard)||!["alpha","additive"].includes(c.blend)||!["cone","radial","planar"].includes(c.directionMode))fail("invalid space, alignment, blend or direction mode.");
  if(!["depth","sizeAscending"].includes(c.sortMode))fail("unsupported sort mode.");
  if(!["point","box","ellipse","sphere"].includes(c.shape.type))fail("unsupported emission shape.");
  for(const key of ["direction","acceleration"] as const)for(const axis of axes)if(!number(c[key][axis],-Infinity))fail(`invalid ${key}.`);
  for(const axis of axes)if(!number(c.shape.size[axis],0))fail("invalid shape size.");
  if(!number(c.shape.innerRadiusRatio,0,1)||c.shape.innerRadiusRatio>0&&c.shape.type!=="ellipse")fail("inner radius requires an ellipse and a fraction in [0, 1].");
  if(c.directionMode==="cone"&&length(c.direction)<1e-9)fail("direction must be nonzero.");
  if(c.directionMode==="planar"&&Math.hypot(c.direction.x,c.direction.y)<1e-9)fail("planar direction must have a nonzero XY projection.");
  if(!Array.isArray(c.bursts)||c.bursts.some(b=>!Number.isInteger(b.count)||!number(b.count,1,20000)))fail("invalid bursts.");
  for(const burst of c.bursts){
    if(typeof burst.time==="number"){if(!number(burst.time,0))fail("invalid burst time.");}
    else {if(!burst.time||!burst.time.rate||burst.time.frame<0)fail("invalid burst frame.");Frame.from(burst.time.frame);frameRate(burst.time.rate.numerator,burst.time.rate.denominator);}
    if(burst.sizeScale!==undefined&&!number(burst.sizeScale,0))fail("invalid burst size scale.");
    if(burst.color&&[burst.color.r,burst.color.g,burst.color.b,burst.color.a].some(v=>!number(v,0,1)))fail("invalid burst color.");
    for(const key of ["velocity","targetVelocity"] as const)if(burst[key]&&axes.some(axis=>!number(burst[key]![axis],-Infinity)))fail(`invalid burst ${key}.`);
    if(burst.targetVelocity&&!c.velocityRelaxation)fail("burst target velocity requires velocity relaxation.");
  }
  validateKeys(c.sizeOverLife,"sizeOverLife",null,true,0);validateKeys(c.colorOverLife,"colorOverLife","rgba",true,0);
  validateKeys(c.speedOverLife,"speedOverLife",null,true,0);
  if(c.velocityRelaxation!==null){
    const motion=c.velocityRelaxation;
    if(!motion||axes.some(axis=>!number(motion.rate?.[axis],0)||!number(motion.target?.[axis],-Infinity)||!number(motion.variation?.[axis],0)))fail("invalid velocity relaxation.");
    if(c.speedOverLife.length)fail("velocity relaxation cannot be combined with a speed curve.");
  }
  if(c.radialExpansion!==null){
    const r=c.radialExpansion;
    if(!r||!number(r.min,0)||!number(r.max,r.min)||!Number.isFinite(Math.exp(r.max*c.lifetime.max)))fail("invalid radial expansion rate or exponent.");
  }
  if(c.cameraContinuation!==null){
    if(!c.cameraContinuation||!number(c.cameraContinuation.padding,0))fail("invalid camera continuation padding.");
    if(c.space!=="local"||c.directionMode!=="cone"||c.spreadDegrees!==0||c.direction.z!==0||c.shape.size.z!==0||c.speed.min<=0||c.acceleration.z!==0||c.acceleration.x*c.direction.x+c.acceleration.y*c.direction.y<0||c.speedOverLife.length||c.velocityRelaxation||c.radialExpansion||c.bursts.some(b=>b.velocity||b.targetVelocity))fail("camera continuation requires a planar local stream with positive speed, zero spread, non-reversing acceleration and no velocity overrides or curves.");
  }
  if(!Array.isArray(c.colorPalette)||c.colorPalette.length>256||c.colorPalette.some(e=>!e||!number(e.weight,0)||!e.color||[e.color.r,e.color.g,e.color.b,e.color.a].some(v=>!number(v,0,1))))fail("invalid weighted color palette.");
  const paletteWeight=c.colorPalette.reduce((sum,e)=>sum+e.weight,0);
  if(c.colorPalette.length&&(!Number.isFinite(paletteWeight)||paletteWeight<=0))fail("color palette needs a positive finite total weight.");
  const a=c.animation,count=assets[c.asset].atlas?.frameCount||1;
  if(!["single","random","fps","lifetime"].includes(a.mode)||!["age","scene"].includes(a.timeSource)||!number(a.framesPerSecond,.001)||typeof a.loop!=="boolean"||typeof a.randomStart!=="boolean")fail("invalid atlas animation.");
  if(!Number.isSafeInteger(a.frame)||a.frame<0||a.frame>=count||!Array.isArray(a.frames)||a.frames.some(n=>!Number.isSafeInteger(n)||n<0||n>=count))fail("atlas frame is out of range.");
}
