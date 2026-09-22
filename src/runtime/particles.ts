/* Shared analytic particle state. Renderers never own a random stream or clock. */
import { Math3D as M } from "./math.js";
import { spriteRect } from "./atlas.js";
import {Frame,Time,frameRate,type FrameTime} from "./animation/time.js";
import type { Scene } from "./scene.js";
import type { Vec3, Color, Key, Range, ParticleEmitter, ParticleState, SpriteAsset } from "./types.js";
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
  if(shape.type==="ellipse"){const a=2*Math.PI*random(),r=Math.sqrt(random());return {x:Math.cos(a)*r*s.x/2,y:Math.sin(a)*r*s.y/2,z:0};}
  if(shape.type==="sphere"){const p=unitSphere(random),r=Math.cbrt(random());return {x:p.x*r*s.x/2,y:p.y*r*s.y/2,z:p.z*r*s.z/2};}
  return {x:0,y:0,z:0};
}
function direction(c:ParticleEmitter,point:Vec3,random:Random):Vec3{
  if(c.directionMode==="radial")return length(point)>1e-9?normalized(point):unitSphere(random);
  const d=normalized(c.direction),u=normalized(cross(Math.abs(d.z)<.9?{x:0,y:0,z:1}:{x:0,y:1,z:0},d)),v=cross(d,u);
  const co=lerp(Math.cos(c.spreadDegrees*Math.PI/180),1,random()),si=Math.sqrt(Math.max(0,1-co*co)),angle=2*Math.PI*random();
  const result={x:0,y:0,z:0};for(const k of axes)result[k]=d[k]*co+si*(u[k]*Math.cos(angle)+v[k]*Math.sin(angle));return result;
}
function frameAt(c:ParticleEmitter,asset:SpriteAsset,age:FrameTime,u:number,random:Random){
  const a=c.animation,frames=a.frames.length?a.frames:Array.from({length:asset.atlas?.frameCount||1},(_,i)=>i),offset=a.randomStart?Math.floor(random()*frames.length):0;
  const i=a.mode==="random"?Math.floor(random()*frames.length):a.mode==="lifetime"?Math.min(frames.length-1,Math.floor(u*frames.length)):a.mode==="fps"?Time.floor(Time.scale(age,Time.decimal(a.framesPerSecond)))+offset:a.frame;
  return a.mode==="single"?a.frame:frames[a.mode==="fps"&&a.loop?i%frames.length:Math.min(frames.length-1,i)];
}
export function particleStates(scene:Scene,id:string,time:FrameTime|number=scene.timelineTime):ParticleState[]{
  const c=scene.component(id,"ParticleEmitter");
  if(!c?.enabled||!scene.active.get(id))return [];
  const position=typeof time==="number"?Time.fromDecimal(time):time,start=Time.convert(Time.fromFrame(c.start.frame),c.start.rate,frameRate(1)),now=Time.subtract(position,start);
  if(now.frame<0)return [];
  const asset=scene.asset(c.asset),cell=asset.atlas?.cellSize||asset.size,spawns=[];
  if(c.rate>0){
    const rate=Time.decimal(c.rate),prewarm=Time.fromDecimal(-c.prewarm),oldest=Time.subtract(now,Time.fromDecimal(c.lifetime.max));
    const first=Time.ceil(Time.scale(Time.compare(prewarm,oldest)>0?prewarm:oldest,rate)),last=Math.min(Time.floor(Time.scale(now,rate)),c.duration>0?Time.ceil(Time.scale(Time.fromDecimal(c.duration),rate))-1:Infinity);
    for(let n=last;n>=first;n--){spawns.push({id:n,offset:Time.fromRatio(BigInt(n)*rate.denominator,rate.numerator),salt:0});if(spawns.length>=c.maxParticles+Math.ceil(c.rate*(c.lifetime.max-c.lifetime.min)))break;}
  }
  c.bursts.forEach((burst,index)=>{const offset=Time.fromDecimal(burst.time),age=Time.subtract(now,offset);if(age.frame>=0&&Time.compare(age,Time.fromDecimal(c.lifetime.max))<0)for(let n=0;n<burst.count;n++)spawns.push({id:n,offset,salt:hash(0,index,0xB5297A4D)});});
  spawns.sort((a,b)=>Time.compare(b.offset,a.offset)||a.salt-b.salt||b.id-a.id);
  const camera=scene.matrixAt(scene.cameraNode.id,position),inverseCamera=M.inverse(camera),current=scene.matrixAt(id,position),states:ParticleState[]=[];
  const perspective=scene.requireComponent(scene.cameraNode.id,"Camera").projection==="perspective",projectionDistance=perspective?scene.projectionDistance:1;
  const cameraRotation=M.identity();for(let col=0;col<3;col++){const n=Math.hypot(camera[col*4],camera[col*4+1],camera[col*4+2]);for(let row=0;row<3;row++)cameraRotation[col*4+row]=camera[col*4+row]/n;}
  const paletteWeight=c.colorPalette.reduce((sum,entry)=>sum+entry.weight,0),motionBlur=scene.component(id,"ParticleMotionBlur");
  for(const birth of spawns){
    const random=mulberry32(hash(c.seed,birth.id,birth.salt)),life=range(c.lifetime,random),ageTime=Time.subtract(now,birth.offset),age=Time.toDecimal(ageTime);
    if(ageTime.frame<0||Time.compare(ageTime,Time.fromDecimal(life))>=0)continue;
    const u=age/life,point=shapePoint(c.shape,random),d=direction(c,point,random),speed=range(c.speed,random),size=range(c.startSize,random)*sampleKeys(c.sizeOverLife,u,1);
    const spin=(range(c.rotation,random)+range(c.angularVelocity,random)*age)*Math.PI/180,frame=frameAt(c,asset,ageTime,u,random);
    const color=sampleKeys(c.colorOverLife,u,white),chosen=paletteColor(c,birth,paletteWeight),tint={r:color.r*c.color.r*chosen.r,g:color.g*c.color.g*chosen.g,b:color.b*c.color.b*chosen.b,a:color.a*c.color.a*chosen.a};
    // Motion remains in the emitter's simulation coordinates. Local particles
    // use the current hierarchy, including particles born before it moved.
    // World matrices below are a rendering result, not persistent particle entities.
    const distance=c.speedOverLife.length?speed*life*integratedSpeed(c.speedOverLife,u):speed*age,speedNow=speed*sampleKeys(c.speedOverLife,u,1);
    const position={x:0,y:0,z:0},velocity={x:0,y:0,z:0};
    for(const k of axes){position[k]=point[k]+d[k]*distance+c.acceleration[k]*age*age/2;velocity[k]=d[k]*speedNow+c.acceleration[k]*age;}
    const birthTime=Time.add(start,birth.offset);
    const origin=c.space==="world"?scene.matrixAt(id,birthTime):current,worldPosition=M.point(origin,position),matrix=M.identity();
    const height=size,width=size*cell.x/cell.y,co=Math.cos(spin),si=Math.sin(spin);
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

export const particleDefaults:ParticleEmitter={asset:"",seed:1,maxParticles:256,start:{frame:Frame.zero,rate:frameRate(30)},duration:0,prewarm:0,rate:10,bursts:[],space:"local",shape:{type:"point",size:{x:0,y:0,z:0}},directionMode:"cone",direction:{x:0,y:1,z:0},spreadDegrees:0,speed:{min:1,max:1},speedOverLife:[],lifetime:{min:1,max:1},startSize:{min:.1,max:.1},rotation:{min:0,max:0},angularVelocity:{min:0,max:0},acceleration:{x:0,y:0,z:0},sizeOverLife:[],color:{r:1,g:1,b:1,a:1},colorPalette:[],colorOverLife:[],billboard:"camera",blend:"alpha",sortMode:"depth",animation:{mode:"single",frame:0,frames:[],framesPerSecond:15,loop:true,randomStart:false}};

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
  if(!Number.isInteger(c.seed)||!number(c.seed,0,4294967295))fail("seed must be an unsigned 32-bit integer.");
  if(!Number.isInteger(c.maxParticles)||!number(c.maxParticles,1,20000))fail("maxParticles must be an integer in [1, 20000].");
  for(const key of ["duration","prewarm","rate"] as const)if(!number(c[key],0))fail(`invalid ${key}.`);
  if(!number(c.spreadDegrees,0,180))fail("invalid cone angle.");
  for(const key of ["speed","lifetime","startSize","rotation","angularVelocity"] as const){const r=c[key],min=["speed","startSize"].includes(key)?0:key==="lifetime"?1e-5:-Infinity;if(!r||!number(r.min,min)||!number(r.max,r.min))fail(`invalid ${key} range.`);}
  if(!["local","world"].includes(c.space)||!["camera","local"].includes(c.billboard)||!["alpha","additive"].includes(c.blend)||!["cone","radial"].includes(c.directionMode))fail("invalid space, alignment, blend or direction mode.");
  if(!["depth","sizeAscending"].includes(c.sortMode))fail("unsupported sort mode.");
  if(!["point","box","ellipse","sphere"].includes(c.shape.type))fail("unsupported emission shape.");
  for(const key of ["direction","acceleration"] as const)for(const axis of axes)if(!number(c[key][axis],-Infinity))fail(`invalid ${key}.`);
  for(const axis of axes)if(!number(c.shape.size[axis],0))fail("invalid shape size.");
  if(c.directionMode==="cone"&&length(c.direction)<1e-9)fail("direction must be nonzero.");
  if(!Array.isArray(c.bursts)||c.bursts.some(b=>!number(b.time,0)||!Number.isInteger(b.count)||!number(b.count,1,20000)))fail("invalid bursts.");
  validateKeys(c.sizeOverLife,"sizeOverLife",null,true,0);validateKeys(c.colorOverLife,"colorOverLife","rgba",true,0);
  validateKeys(c.speedOverLife,"speedOverLife",null,true,0);
  if(!Array.isArray(c.colorPalette)||c.colorPalette.length>256||c.colorPalette.some(e=>!e||!number(e.weight,0)||!e.color||[e.color.r,e.color.g,e.color.b,e.color.a].some(v=>!number(v,0,1))))fail("invalid weighted color palette.");
  const paletteWeight=c.colorPalette.reduce((sum,e)=>sum+e.weight,0);
  if(c.colorPalette.length&&(!Number.isFinite(paletteWeight)||paletteWeight<=0))fail("color palette needs a positive finite total weight.");
  const a=c.animation,count=assets[c.asset].atlas?.frameCount||1;
  if(!["single","random","fps","lifetime"].includes(a.mode)||!number(a.framesPerSecond,.001)||typeof a.loop!=="boolean"||typeof a.randomStart!=="boolean")fail("invalid atlas animation.");
  if(!Number.isSafeInteger(a.frame)||a.frame<0||a.frame>=count||!Array.isArray(a.frames)||a.frames.some(n=>!Number.isSafeInteger(n)||n<0||n>=count))fail("atlas frame is out of range.");
}
