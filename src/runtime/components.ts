import type { SceneData, Entity, SpriteAsset, Component, ComponentType, Transform, Transition } from "./types.js";
/* Component contracts shared by both rendering backends. No scene-specific IDs. */
import { particleDefaults, validateEmitter, validateKeys } from "./particles.js";
import {Frame,frameRate} from "./animation/time.js";
const start={frame:Frame.zero,rate:frameRate(30)};
const rgba = {r:1,g:1,b:1,a:1};
const transitionDefaults=new Map<Transition["kind"],Transition>([
  ["grid",{kind:"grid",progress:0,target:null,grid:{cellSize:{x:.36,y:.36},origin:{x:0,y:0},direction:{x:1,y:0},feather:4.8}}],
  ["pinwheel",{kind:"pinwheel",progress:0,target:null,pinwheel:{cellSize:{x:.2666666667,y:.2666666667},origin:{x:0,y:0},profiles:[{fronts:[[0,0],[0,0],[0,0],[0,0]]},{fronts:[[1,2],[1,2],[1,2],[1,2]]}]}}],
  ["dissolve",{kind:"dissolve",progress:0,target:null,dissolve:{cellSize:{x:.3,y:.3},origin:{x:0,y:0},seed:1,direction:{x:0,y:0},feather:1}}],
  ["stripes",{kind:"stripes",progress:0,target:null,stripes:{axis:"x",period:.1,phase:0}}],
]);
export const componentTypes = new Map<ComponentType,object>([
  ["Camera", {projection:"orthographic",verticalFovDegrees:50,principalPoint:{x:.5,y:.5},referenceVerticalSize:10,referenceAspect:16/9,aspectPolicy:"expandFromReference",near:.1,far:100,clearColor:{r:0,g:0,b:0,a:1}}],
  ["Vignette", {centerViewport:{x:.5,y:.5},quadratic:.2,quartic:.4,verticalWeight:1,depth:null}],
  ["ViewportFrame", {insetsWorld:{left:0,right:0,top:0,bottom:0},radiusWorld:0,color:{r:0,g:0,b:0,a:1},innerShadow:{offsetWorld:{x:0,y:0},color:{r:0,g:0,b:0,a:1},opacity:0}}],
  ["SpriteRenderer", {asset:null,color:rgba,hueDegrees:0,saturation:1,brightness:1,contrast:1,whiteMix:0,frame:0,sortingOrder:0}],
  ["SortingGroup", {anchor:{x:0,y:0,z:0}}],
  ["SpriteNumberRenderer", {asset:null,value:0,rounding:"round",minDigits:1,suffix:"",glyphs:"0123456789",advances:[],alignment:"left",repeatWorld:null,color:rgba}],
  ["SpriteAnimator", {start,framesPerSecond:15,frames:[],loop:false,hideOutside:true}],
  ["OpacityGradient", {start:{x:0,y:0},end:{x:0,y:-1}}],
  ["Flicker", {mode:"periodic",frequency:15,dutyCycle:.5,probability:.5,seed:1,start,phase:0}],
  ["TransformAnimator", {position:[],rotation:[],scale:[]}],
  ["ParticleEmitter", particleDefaults],
  ["TiledSpriteRenderer", {asset:null,color:rgba,saturation:1,coverage:"camera",clipBounds:null,wrap:{x:"repeat",y:"clamp"},origin:{x:0,y:0}}],
  ["CylindricalSpriteRenderer", {asset:null,color:rgba,radius:1,length:{min:.01,max:100},tileLength:2*Math.PI,segments:100,uvOffset:{x:0,y:0},lighting:{ambient:1,diffuse:0,direction:{x:1,y:0,z:0}}}],
  ["GaussianBlur", {sigmaWorld:{x:0,y:0}}],
  ["SpriteMotionBlur", {translationWorld:{x:0,y:0},radialAmount:0,center:{x:0,y:0},samples:25,dilationPixels:0,softnessPixels:0,alphaGain:1,clipToSprite:false}],
  ["DirectionalBlur", {sigmaWorld:0,angleDegrees:0}],
  ["PlaneRenderer", {color:rgba,coverage:"fixed",shape:"rectangle",size:{x:1,y:1},clipBounds:null}],
  ["Transition", {kind:"grid",progress:0,target:null}],
  ["ParticleMotionBlur", {shutterSeconds:1/30,maxSigmaWorld:.3,dilationPixels:0,softnessPixels:0,alphaGain:1}],
  ["LineRenderer", {start:{x:-.5,y:0},end:{x:.5,y:0},width:.01,color:rgba,coverage:"segment"}],
  ["ProceduralNoise", {seed:1,textureSize:{x:256,y:256},worldSize:{x:2.56,y:2.56},origin:{x:0,y:0},range:.4,channelGain:{r:1,g:1,b:1},bands:[]}],
  ["DropShadow", {offsetWorld:{x:0,y:0},sigmaWorld:.05,color:{r:0,g:0,b:0,a:1},opacity:1}],
  ["Glow", {threshold:.4,softness:.4,sigmaWorld:.05,intensity:1,color:rgba,blend:"additive"}],
  ["AudioPlayer", {asset:"",volume:1,muted:false,loop:false,preservesPitch:false,title:"",artist:"",album:""}],
  ["AnimationPlayer", {sequence:"",clock:null}],
  ["PlayerControls", {player:null,hideDelayMs:3000}],
]);
export function merge<T extends object>(target:T,source:object):T {
  const output=target as Record<string,unknown>;
  for(const [key,value] of Object.entries(source)){
    if(["__proto__","prototype","constructor"].includes(key))throw new Error(`Invalid field: ${key}`);
    if(value&&typeof value==="object"&&!Array.isArray(value))output[key]=merge((output[key]||{}) as object,value);
    else output[key]=structuredClone(value);
  }
  return target;
}
const fail = (message:string) => { throw new Error(message); };
function finite(value:number, label:string, minimum=-Infinity, maximum=Infinity) {
  if (!Number.isFinite(value) || value<minimum || value>maximum) fail(`Invalid ${label}.`);
}
function vector(v:object,axes:string,label:string,minimum=-Infinity,maximum=Infinity){for(const a of axes)finite((v as Record<string,number>)[a],`${label}.${a}`,minimum,maximum);}
export function normalizeScene(input:unknown):SceneData {
  const data=structuredClone(input) as SceneData;
  if(data.schemaVersion!==1)fail("Unsupported scene schemaVersion.");
  data.coordinateSystem=merge({handedness:"left",up:"+Y",forward:"+Z",rotationOrder:"ZXY",rotationUnit:"degrees",referencePixelsPerUnit:100},data.coordinateSystem||{});
  const cs=data.coordinateSystem;
  if(cs.handedness!=="left"||cs.up!=="+Y"||cs.forward!=="+Z"||cs.rotationOrder!=="ZXY"||cs.rotationUnit!=="degrees")fail("This runtime uses left-handed +Y-up/+Z-forward coordinates and ZXY Euler degrees.");
  finite(cs.referencePixelsPerUnit,"referencePixelsPerUnit",.001);
  data.presentation=merge({referenceAspect:false,toggleKey:"KeyA",activeCamera:null},data.presentation||{});
  data.rendering=merge({texturePixelsPerUnit:cs.referencePixelsPerUnit},data.rendering||{});
  data.timeline=merge({duration:0,frameRate:30,autoplay:false,loop:false},data.timeline||{});
  finite(data.timeline.duration,"timeline.duration",0);finite(data.timeline.frameRate,"timeline.frameRate",.001);
  for(const key of ["autoplay","loop"] as const)if(typeof data.timeline[key]!=="boolean")fail(`Invalid timeline.${key}.`);
  finite(data.rendering.texturePixelsPerUnit,"texturePixelsPerUnit",1,4096);
  data.assets ||= {};
  for(const [id,asset] of Object.entries(data.assets)){
    if(typeof asset.file!=="string"||!asset.file)fail(`Invalid asset: ${id}`);
    if(asset.type==="Audio")continue;
    if(asset.type!=="Sprite")fail(`Unsupported asset type: ${id}`);
    vector(asset.size,"xy",`${id}.size`,1,8192);
    if(!Number.isInteger(asset.size.x)||!Number.isInteger(asset.size.y))fail(`Sprite dimensions must be integers: ${id}`);
    finite(asset.pixelsPerUnit,`${id}.pixelsPerUnit`,.0001);
    asset.pivot ||= {x:.5,y:.5};vector(asset.pivot,"xy",`${id}.pivot`);
    asset.filter ||= "point";if(!["point","linear"].includes(asset.filter))fail(`Unsupported sprite filter: ${asset.filter}`);
    if(asset.atlas){
      const a=asset.atlas;vector(a.cellSize,"xy",`${id}.atlas.cellSize`,1,8192);
      for(const value of [a.cellSize.x,a.cellSize.y,a.columns,a.rows,a.frameCount])if(!Number.isSafeInteger(value)||value<1)fail(`Invalid atlas dimensions: ${id}`);
      const padding=a.padding??0;
      if(!Number.isSafeInteger(padding)||padding<0)fail(`Invalid atlas padding: ${id}`);
      if(a.columns*(a.cellSize.x+2*padding)!==asset.size.x||a.rows*(a.cellSize.y+2*padding)!==asset.size.y||a.frameCount>a.columns*a.rows)fail(`Atlas does not fit its image: ${id}`);
    }
    delete (asset as SpriteAsset & {embedded?:unknown}).embedded;
  }
  const sprites=Object.fromEntries(Object.entries(data.assets).filter((entry):entry is [string,SpriteAsset]=>entry[1].type==="Sprite"));
  const ids=new Set<string>(),entities=new Map<string,Entity>();let cameras=0;
  function visit(node:Entity){
    if(!node||typeof node.id!=="string"||!node.id||ids.has(node.id))fail(`Missing or duplicate entity ID: ${node?.id}`);
    ids.add(node.id);entities.set(node.id,node);node.name ||= node.id;node.active ??= true;
    if(typeof node.active!=="boolean")fail(`Entity active must be a boolean: ${node.id}`);
    node.transform=merge({localPosition:{x:0,y:0,z:0},localRotation:{x:0,y:0,z:0},localScale:{x:1,y:1,z:1}},node.transform||{});
    for(const key of ["localPosition","localRotation","localScale"] as const)vector(node.transform[key],"xyz",`${node.id}.${key}`);
    if(Object.values(node.transform.localScale).some(v=>v===0))fail(`Transform scale cannot be zero: ${node.id}`);
    node.components ||= [];node.children ||= [];const types=new Set<ComponentType>();
    node.components=node.components.map(raw=>{
      if(!componentTypes.has(raw.type))fail(`Unsupported component ${raw.type} on ${node.id}.`);
      if(types.has(raw.type))fail(`Duplicate ${raw.type} on ${node.id}.`);types.add(raw.type);
      const defaults=raw.type==="Transition"?transitionDefaults.get(raw.kind===undefined?"grid":raw.kind):componentTypes.get(raw.type);
      if(!defaults)fail(`Unsupported Transition.kind on ${node.id}.`);
      const c=merge({type:raw.type,enabled:true,...structuredClone(defaults)},raw) as Component;
      if(typeof c.enabled!=="boolean")fail(`Component enabled must be a boolean: ${node.id}.${c.type}`);
      if("asset" in c&&!data.assets[c.asset])fail(`Unknown asset ${c.asset} on ${node.id}.`);
      if("asset" in c&&c.type!=="AudioPlayer"&&!sprites[c.asset])fail(`${c.type} requires a Sprite asset.`);
      if("color" in c)vector(c.color,"rgba",`${node.id}.${c.type}.color`,0,1);
      if(c.type==="Camera"){
        cameras++;if(!["orthographic","perspective"].includes(c.projection))fail("Unsupported camera projection.");
        finite(c.verticalFovDegrees,"verticalFovDegrees",.001,179);vector(c.principalPoint,"xy","principalPoint");
        finite(c.referenceVerticalSize,"referenceVerticalSize",.0001);finite(c.referenceAspect,"referenceAspect",.0001);
        finite(c.near,"near",.0001);finite(c.far,"far",c.near+.0001);
        vector(c.clearColor,"rgba","clearColor",0,1);
        if(!["expandFromReference","fillReference"].includes(c.aspectPolicy))fail(`Unsupported aspect policy: ${c.aspectPolicy}`);
      }
      if(c.type==="Vignette"){vector(c.centerViewport,"xy","centerViewport");finite(c.quadratic,"quadratic",0);finite(c.quartic,"quartic",0);finite(c.verticalWeight,"verticalWeight",.0001);if(c.depth!==null)finite(c.depth,"Vignette.depth",.000001);}
      if(c.type==="ViewportFrame"){
        for(const side of ["left","right","top","bottom"] as const)finite(c.insetsWorld[side],`ViewportFrame.insetsWorld.${side}`,0);
        finite(c.radiusWorld,"ViewportFrame.radiusWorld",0);
        vector(c.innerShadow.offsetWorld,"xy","ViewportFrame.innerShadow.offsetWorld");
        vector(c.innerShadow.color,"rgba","ViewportFrame.innerShadow.color",0,1);finite(c.innerShadow.opacity,"ViewportFrame.innerShadow.opacity",0,1);
      }
      if(c.type==="SpriteRenderer"){
        finite(c.hueDegrees,"hueDegrees");
        if(!Number.isSafeInteger(c.sortingOrder))fail("SpriteRenderer.sortingOrder must be an integer.");
        finite(c.whiteMix,"SpriteRenderer.whiteMix",0,1);
        finite(c.saturation,"SpriteRenderer.saturation",0);finite(c.brightness,"SpriteRenderer.brightness",0);finite(c.contrast,"SpriteRenderer.contrast",0);
        if(!Number.isSafeInteger(c.frame)||c.frame<0||c.frame>=(sprites[c.asset].atlas?.frameCount||1))fail(`Invalid sprite frame: ${node.id}`);
      }
      if(c.type==="SpriteAnimator"||c.type==="Flicker"||c.type==="ParticleEmitter"){
        if("startTime" in c)fail(`${c.type}.startTime has been replaced by start: {frame, rate}.`);
        Frame.from(c.start.frame);frameRate(c.start.rate.numerator,c.start.rate.denominator);
      }
      if(c.type==="SpriteAnimator"){
        finite(c.framesPerSecond,"framesPerSecond",.001);
        if(!Array.isArray(c.frames)||c.frames.some(n=>!Number.isSafeInteger(n)||n<0))fail(`Invalid animation frames: ${node.id}`);
        if(typeof c.loop!=="boolean"||typeof c.hideOutside!=="boolean")fail(`Invalid animation playback: ${node.id}`);
      }
      if(c.type==="ParticleEmitter")validateEmitter(c,sprites);
      if(c.type==="Flicker"){
        if(c.mode!=="periodic"&&c.mode!=="random")fail("Invalid Flicker mode.");
        finite(c.frequency,"Flicker.frequency",.001,10000);finite(c.dutyCycle,"Flicker.dutyCycle",0,1);finite(c.probability,"Flicker.probability",0,1);
        finite(c.phase,"Flicker.phase",0,1);
        if(!Number.isSafeInteger(c.seed)||c.seed<0||c.seed>0xffffffff)fail("Invalid Flicker seed.");
      }
      if(c.type==="SpriteNumberRenderer"){
        finite(c.value,"SpriteNumberRenderer.value",-1e15,1e15);
        if(!["round","floor","ceil"].includes(c.rounding)||!["left","center","right"].includes(c.alignment))fail("Invalid numeric display mode.");
        if(!Number.isInteger(c.minDigits)||c.minDigits<1||c.minDigits>16)fail("Invalid minimum digit count.");
        const count=sprites[c.asset].atlas?.frameCount??1;
        if(typeof c.glyphs!=="string"||new Set(c.glyphs).size!==c.glyphs.length||c.glyphs.length>count||!Array.from("0123456789").every(ch=>c.glyphs.includes(ch)))fail("Numeric atlas requires distinct glyphs for 0–9.");
        if(Math[c.rounding](c.value)<0&&!c.glyphs.includes("-"))fail("Negative values require a minus glyph.");
        if(typeof c.suffix!=="string"||c.suffix.length>8||!Array.from(c.suffix).every(ch=>c.glyphs.includes(ch)))fail("Unknown numeric suffix glyph.");
        if(c.advances.length&&c.advances.length!==c.glyphs.length)fail("Glyph advances must match the glyph mapping.");
        c.advances.forEach(v=>finite(v,"glyph advance",.0001));
        if(c.repeatWorld)vector(c.repeatWorld,"xy","repeatWorld",.0001);
      }
      if(c.type==="AudioPlayer"){
        if(data.assets[c.asset].type!=="Audio")fail("AudioPlayer requires an Audio asset.");
        finite(c.volume,"AudioPlayer.volume",0,1);
        if(typeof c.muted!=="boolean"||typeof c.loop!=="boolean"||typeof c.preservesPitch!=="boolean")fail("Invalid AudioPlayer playback settings.");
        for(const key of ["title","artist","album"] as const)if(typeof c[key]!=="string")fail(`Invalid AudioPlayer.${key}.`);
      }
      if(c.type==="AnimationPlayer"){
        c.sequence ||= data.animation?.master||"";
        if(!data.animation?.sequences[c.sequence])fail(`AnimationPlayer references an unknown sequence: ${c.sequence}`);
        if(c.clock!==null&&(!c.clock||typeof c.clock.entity!=="string"||c.clock.component!=="AudioPlayer"))fail("AnimationPlayer.clock must reference an AudioPlayer component.");
      }
      if(c.type==="PlayerControls"){
        finite(c.hideDelayMs,"PlayerControls.hideDelayMs",0);
        if(c.player!==null&&(!c.player||typeof c.player.entity!=="string"||c.player.component!=="AnimationPlayer"))fail("PlayerControls.player must reference an AnimationPlayer component.");
      }
      if(c.type==="TransformAnimator")for(const key of ["position","rotation","scale"] as const){validateKeys(c[key],`TransformAnimator.${key}`,"xyz");if(key==="scale"&&c[key].some(k=>Object.values(k.value).some(v=>v<=0)))fail("Animated scales must be positive.");}
      if(c.type==="CylindricalSpriteRenderer"){
        if(sprites[c.asset].atlas)fail("CylindricalSpriteRenderer requires a standalone tile.");
        finite(c.radius,"cylinder radius",.000001);finite(c.tileLength,"cylinder tile length",.000001);
        finite(c.length.min,"cylinder start");finite(c.length.max,"cylinder end",c.length.min+.000001);
        if(!Number.isSafeInteger(c.segments)||c.segments<8||c.segments>512)fail("Cylinder segments must be an integer from 8 to 512.");
        vector(c.uvOffset,"xy","cylinder UV offset");vector(c.lighting.direction,"xyz","cylinder light direction");
        if(Math.hypot(...Object.values(c.lighting.direction))<.000001)fail("Cylinder light direction cannot be zero.");
        finite(c.lighting.ambient,"cylinder ambient",0);finite(c.lighting.diffuse,"cylinder diffuse",0);
      }
      if(c.type==="TiledSpriteRenderer"){
        finite(c.saturation,"saturation",0);
        if(sprites[c.asset].atlas)fail("TiledSpriteRenderer needs a standalone tile, not an atlas.");
        if(c.coverage!=="camera"||c.wrap.x!=="repeat"||!["clamp","clampBottom","transparent","repeat","repeatBottom"].includes(c.wrap.y))fail("TiledSpriteRenderer requires camera coverage, repeat X, and a supported Y wrap mode.");
        if(sprites[c.asset].filter!=="point")fail("TiledSpriteRenderer requires point-filtered pixel art.");vector(c.origin,"xy","tile origin");
      }
      if(c.type==="TiledSpriteRenderer"&&c.clipBounds){for(const side of ["left","right","bottom","top"] as const)if(c.clipBounds[side]!==null)finite(c.clipBounds[side],`tile clip ${side}`);}
      if(c.type==="SpriteMotionBlur"){vector(c.translationWorld,"xy","translationWorld");vector(c.center,"xy","blur center");finite(c.radialAmount,"radialAmount",0,.95);for(const key of ["dilationPixels","softnessPixels","alphaGain"]as const)finite(c[key],`SpriteMotionBlur.${key}`,0);if(typeof c.clipToSprite!=="boolean")fail("SpriteMotionBlur.clipToSprite must be a boolean.");if(!Number.isInteger(c.samples)||c.samples<3||c.samples>33||c.samples%2!==1)fail("Sprite motion blur needs an odd sample count from 3 to 33.");}
      if(c.type==="GaussianBlur")vector(c.sigmaWorld,"xy","sigmaWorld",0);
      if(c.type==="SortingGroup")vector(c.anchor,"xyz","SortingGroup.anchor");
      if(c.type==="DirectionalBlur"){finite(c.sigmaWorld,"DirectionalBlur.sigmaWorld",0);finite(c.angleDegrees,"DirectionalBlur.angleDegrees");}
      if(c.type==="PlaneRenderer"){
        if(!["rectangle","ellipse"].includes(c.shape)||c.shape==="ellipse"&&c.coverage!=="fixed")fail("An ellipse requires fixed plane bounds.");
        vector(c.size,"xy","PlaneRenderer.size",.000001);if(!["camera","fixed"].includes(c.coverage))fail("Invalid PlaneRenderer coverage.");
        if(c.clipBounds){for(const side of ["left","right","bottom","top"] as const)if(c.clipBounds[side]!==null)finite(c.clipBounds[side],`PlaneRenderer.clipBounds.${side}`);
          if(c.clipBounds.left!==null&&c.clipBounds.right!==null&&c.clipBounds.left>=c.clipBounds.right||c.clipBounds.bottom!==null&&c.clipBounds.top!==null&&c.clipBounds.bottom>=c.clipBounds.top)fail("PlaneRenderer clip bounds must have positive area.");}
      }
      if(c.type==="OpacityGradient"){vector(c.start,"xy","OpacityGradient.start");vector(c.end,"xy","OpacityGradient.end");if(Math.hypot(c.end.x-c.start.x,c.end.y-c.start.y)<1e-9)fail("OpacityGradient needs distinct endpoints.");}
      if(c.type==="Transition"){
        finite(c.progress,"Transition.progress",0,1);
        if(c.target!==null&&(!c.target||typeof c.target.entity!=="string"))fail("Transition.target must reference an entity.");
        if(c.kind==="grid"){
          const g=c.grid;vector(g.cellSize,"xy","Transition.grid.cellSize",.0001);vector(g.origin,"xy","Transition.grid.origin");vector(g.direction,"xy","Transition.grid.direction");finite(g.feather,"Transition.grid.feather",.0001);
          if(Math.hypot(g.direction.x,g.direction.y)<1e-9)fail("Transition.grid needs a nonzero direction.");
        }else if(c.kind==="dissolve"){
          vector(c.dissolve.direction,"xy","dissolve.direction");finite(c.dissolve.feather,"dissolve.feather",.0001);
          vector(c.dissolve.cellSize,"xy","Transition.dissolve.cellSize",.0001);vector(c.dissolve.origin,"xy","Transition.dissolve.origin");
          if(!Number.isSafeInteger(c.dissolve.seed))fail("Transition.dissolve.seed must be an integer.");
        }else if(c.kind==="stripes"){
          if(!["x","y"].includes(c.stripes.axis))fail("Invalid stripe axis.");finite(c.stripes.period,"stripes.period",.0001);finite(c.stripes.phase,"stripes.phase");
        }else{
          const p=c.pinwheel;vector(p.cellSize,"xy","Transition.pinwheel.cellSize",.0001);vector(p.origin,"xy","Transition.pinwheel.origin");
          if(!Array.isArray(p.profiles)||p.profiles.length<2||p.profiles.length>64)fail("Transition.pinwheel needs 2–64 profiles.");
          for(const profile of p.profiles){
            if(!Array.isArray(profile.fronts)||profile.fronts.length!==4)fail("Each pinwheel profile needs four fronts.");
            for(const front of profile.fronts){
              if(!Array.isArray(front)||front.length<2||front.length>16)fail("A pinwheel front needs 2–16 spatial samples.");
              front.forEach(v=>finite(v,"Transition.pinwheel.front",0));
            }
          }
        }
      }
      if(c.type==="ParticleMotionBlur")for(const key of ["shutterSeconds","maxSigmaWorld","dilationPixels","softnessPixels","alphaGain"] as const)finite(c[key],`ParticleMotionBlur.${key}`,0);
      if(c.type==="LineRenderer"){vector(c.start,"xy","LineRenderer.start");vector(c.end,"xy","LineRenderer.end");finite(c.width,"LineRenderer.width",0);if(!["camera","segment","ray"].includes(c.coverage))fail("Invalid LineRenderer coverage.");}
      if(c.type==="DropShadow"||c.type==="Glow")finite(c.sigmaWorld,"sigmaWorld",0);
      if(c.type==="DropShadow"){vector(c.offsetWorld,"xy","offsetWorld");finite(c.opacity,"opacity",0,1);}
      if(c.type==="Glow"){finite(c.threshold,"threshold",0,1);finite(c.softness,"softness",.0001);finite(c.intensity,"intensity",0);if(!["alpha","additive"].includes(c.blend))fail("Invalid Glow blend.");}
      if(c.type==="ProceduralNoise"){
        if(!Number.isSafeInteger(c.seed))fail("Noise seed must be an integer.");
        vector(c.textureSize,"xy","textureSize",1,4096);if(!Number.isInteger(c.textureSize.x)||!Number.isInteger(c.textureSize.y))fail("Noise dimensions must be integers.");
        vector(c.worldSize,"xy","worldSize",.0001);vector(c.origin,"xy","noise origin");finite(c.range,"noise range",.0001);
        vector(c.channelGain,"rgb","ProceduralNoise.channelGain");
        for(const band of c.bands){vector(band.sigmaTexels,"xy","sigmaTexels",0);finite(band.variance,"variance",0);}
      }
      return c;
    });
    if(["SpriteRenderer","SpriteNumberRenderer","TiledSpriteRenderer","CylindricalSpriteRenderer","PlaneRenderer","LineRenderer","ParticleEmitter"].filter(t=>types.has(t as ComponentType)).length>1)fail(`Use one renderer per entity: ${node.id}`);
    if(types.has("SpriteAnimator")){
      const sprite=node.components.find(c=>c.type==="SpriteRenderer"),animator=node.components.find(c=>c.type==="SpriteAnimator");
      if(!sprite||!sprites[sprite.asset].atlas)fail(`SpriteAnimator requires a sprite atlas: ${node.id}`);
      if(animator!.frames.some(n=>n>=sprites[sprite!.asset].atlas!.frameCount))fail(`Animation frame outside atlas: ${node.id}`);
    }
    if(types.has("ParticleEmitter")&&(types.has("SpriteRenderer")||types.has("TiledSpriteRenderer")))fail(`Use a separate emitter entity: ${node.id}`);
    if(types.has("Glow")&&!types.has("TiledSpriteRenderer")&&!types.has("SpriteNumberRenderer")&&!types.has("SpriteRenderer")&&!types.has("ParticleEmitter")&&!types.has("LineRenderer"))fail(`Glow requires SpriteRenderer, LineRenderer or ParticleEmitter on ${node.id}.`);
    if(types.has("SpriteMotionBlur")&&!types.has("SpriteRenderer"))fail(`SpriteMotionBlur requires SpriteRenderer on ${node.id}.`);
    if(types.has("DropShadow")&&!types.has("SpriteRenderer"))fail(`DropShadow requires SpriteRenderer on ${node.id}.`);
    if(types.has("GaussianBlur")&&!types.has("TiledSpriteRenderer")&&!types.has("Camera"))fail(`GaussianBlur requires TiledSpriteRenderer or Camera on ${node.id}.`);
    if(types.has("DirectionalBlur")&&!types.has("TiledSpriteRenderer"))fail(`DirectionalBlur requires TiledSpriteRenderer on ${node.id}.`);
    const transition=node.components.find(c=>c.type==="Transition");
    if(transition&&!transition.target&&!types.has("PlaneRenderer"))fail(`Transition requires a target or PlaneRenderer on ${node.id}.`);
    if(transition?.target&&types.has("PlaneRenderer"))fail(`A targeted Transition does not also render a plane: ${node.id}.`);
    if(types.has("ParticleMotionBlur")&&!types.has("ParticleEmitter"))fail(`ParticleMotionBlur requires ParticleEmitter on ${node.id}.`);
    if(types.has("ProceduralNoise")&&!types.has("TiledSpriteRenderer")&&!types.has("SpriteRenderer")&&!types.has("PlaneRenderer"))fail(`ProceduralNoise requires a sprite or plane renderer on ${node.id}.`);
    if(types.has("Vignette")&&!types.has("Camera"))fail(`Vignette requires Camera on ${node.id}.`);
    if(types.has("OpacityGradient")&&!types.has("SpriteRenderer"))fail(`OpacityGradient requires SpriteRenderer on ${node.id}.`);
    if(types.has("ViewportFrame")&&!types.has("Camera"))fail(`ViewportFrame requires Camera on ${node.id}.`);
    node.children.forEach(visit);
  }
  visit(data.root);if(!cameras)fail("The scene needs a Camera component.");
  for(const node of entities.values())for(const c of node.components){
    if(c.type==="Transition"&&c.target){
      const target=entities.get(c.target.entity);if(!target)fail(`Unknown Transition target: ${c.target.entity}`);
      const contains=(entity:Entity):boolean=>entity.id===node.id||entity.children.some(contains);
      if(target&&contains(target))fail("A Transition controller cannot belong to its target subtree.");
    }
    if(c.type==="AnimationPlayer"&&c.clock&&!entities.get(c.clock.entity)?.components.some(component=>component.type==="AudioPlayer"))fail(`Unknown AudioPlayer clock: ${c.clock.entity}`);
    if(c.type==="PlayerControls"&&c.player&&!entities.get(c.player.entity)?.components.some(component=>component.type==="AnimationPlayer"))fail(`Unknown AnimationPlayer for controls: ${c.player.entity}`);
  }
  if(data.presentation.activeCamera&&!ids.has(data.presentation.activeCamera))fail("Unknown activeCamera entity.");
  return data;
}
