import type {FrameStamp} from "./animation/time.js";
export interface Vec2 {x:number;y:number}
export interface Vec3 extends Vec2 {z:number}
export interface RGB {r:number;g:number;b:number}
export interface Color extends RGB {a:number}
export interface Transform {localPosition:Vec3;localRotation:Vec3;localScale:Vec3}
export type Matrix=number[];
export interface Range {min:number;max:number}
export interface Key<T> {time:number;value:T;interpolation?:"linear"|"step"}
export interface Bounds {left:number;right:number;bottom:number;top:number}
export type ClipBounds={ [K in keyof Bounds]:number|null };
export interface Rect {x:number;y:number;width:number;height:number}
export interface PixelImage {width:number;height:number;channels:number;data:Uint8Array;bounds?:Bounds}
export interface SpriteAsset {
  type:"Sprite";file:string;size:Vec2;pixelsPerUnit:number;pivot:Vec2;filter:"point"|"linear";
  atlas?:{cellSize:Vec2;columns:number;rows:number;frameCount:number;padding?:number};reconstruction?:unknown;
}
export interface AudioAsset {type:"Audio";file:string;reconstruction?:unknown}
export type Asset=SpriteAsset|AudioAsset;
export interface ComponentReference<K extends ComponentType> {entity:string;component:K}
export interface AudioPlayerComponent {asset:string;volume:number;muted:boolean;loop:boolean;preservesPitch:boolean;title:string;artist:string;album:string}
export interface AnimationPlayerComponent {sequence:string;clock:ComponentReference<"AudioPlayer">|null}
export interface PlayerControlsComponent {player:ComponentReference<"AnimationPlayer">|null;hideDelayMs:number}
export interface Camera {projection:"orthographic"|"perspective";verticalFovDegrees:number;principalPoint:Vec2;referenceVerticalSize:number;referenceAspect:number;aspectPolicy:"expandFromReference"|"fillReference";near:number;far:number;clearColor:Color}
export interface Vignette {centerViewport:Vec2;quadratic:number;quartic:number;verticalWeight:number;depth:number|null}
/** Camera-space rounded aperture. Dimensions use world units so aspect expansion
 * extends the opening without stretching its circular corners or border width. */
export interface ViewportFrame {
  insetsWorld:{left:number;right:number;top:number;bottom:number};radiusWorld:number;color:Color;
  innerShadow:{offsetWorld:Vec2;color:Color;opacity:number};
}
export interface SpriteRenderer {asset:string;color:Color;hueDegrees:number;saturation:number;brightness:number;whiteMix:number;frame:number}
/** A continuous numeric value selects individual native atlas glyphs only at
 * display time. Repeat distances are local world units, independent of digits. */
export interface SpriteNumberRenderer {asset:string;value:number;rounding:"round"|"floor"|"ceil";minDigits:number;suffix:string;glyphs:string;advances:number[];alignment:"left"|"center"|"right";repeatWorld:Vec2|null;color:Color}
export interface SpriteAnimator {start:FrameStamp;framesPerSecond:number;frames:number[];loop:boolean;hideOutside:boolean}
/** Local-space alpha ramp on the source sprite; independent of its glow. */
export interface OpacityGradient {start:Vec2;end:Vec2}
export interface Flicker {mode:"periodic"|"random";frequency:number;dutyCycle:number;probability:number;seed:number;start:FrameStamp;phase:number}
export interface TransformAnimator {position:Key<Vec3>[];rotation:Key<Vec3>[];scale:Key<Vec3>[]}
export interface TiledSpriteRenderer {asset:string;color:Color;saturation:number;coverage:"camera";clipBounds:ClipBounds|null;wrap:{x:"repeat";y:"clamp"|"clampBottom"|"transparent"|"repeat"|"repeatBottom"};origin:Vec2}
export interface GaussianBlur {sigmaWorld:Vec2}
export interface SpriteMotionBlur {translationWorld:Vec2;radialAmount:number;center:Vec2;samples:number;dilationPixels:number;softnessPixels:number;alphaGain:number}
export interface DirectionalBlur {sigmaWorld:number;angleDegrees:number}
export interface PlaneRenderer {color:Color;coverage:"camera"|"fixed";shape:"rectangle"|"ellipse";size:Vec2;clipBounds:{left:number|null;right:number|null;bottom:number|null;top:number|null}|null}
export interface GridTransitionSettings {cellSize:Vec2;origin:Vec2;direction:Vec2;feather:number}
export interface TransitionBase {progress:number;target:{entity:string}|null}
export interface GridTransition extends TransitionBase {kind:"grid";grid:GridTransitionSettings}
/** Four blade fronts in counterclockwise quadrant order. Values are widths in
 * native grid cells at integer distances along the corresponding radial axis. */
export interface PinwheelProfile {fronts:[number[],number[],number[],number[]]}
export interface PinwheelTransitionSettings {cellSize:Vec2;origin:Vec2;profiles:PinwheelProfile[]}
export interface PinwheelTransition extends TransitionBase {kind:"pinwheel";pinwheel:PinwheelTransitionSettings}
export interface DissolveTransitionSettings {cellSize:Vec2;origin:Vec2;seed:number;direction:Vec2;feather:number}
export interface DissolveTransition extends TransitionBase {kind:"dissolve";dissolve:DissolveTransitionSettings}
export interface StripeTransition extends TransitionBase {kind:"stripes";stripes:{axis:"x"|"y";period:number;phase:number}}
// Additional kinds extend this discriminated union with their own settings.
export type Transition=GridTransition|PinwheelTransition|DissolveTransition|StripeTransition;
export interface ParticleMotionBlur {shutterSeconds:number;maxSigmaWorld:number;dilationPixels:number;softnessPixels:number;alphaGain:number}
export interface LineRenderer {start:Vec2;end:Vec2;width:number;color:Color;coverage:"segment"|"camera"}
export interface ProceduralNoise {seed:number;textureSize:Vec2;worldSize:Vec2;origin:Vec2;range:number;channelGain:RGB;bands:{sigmaTexels:Vec2;variance:number}[]}
export interface DropShadow {offsetWorld:Vec2;sigmaWorld:number;color:Color;opacity:number}
export interface Glow {threshold:number;softness:number;sigmaWorld:number;intensity:number;color:Color;blend:"alpha"|"additive"}
export interface ParticleEmitter {
  asset:string;seed:number;maxParticles:number;start:FrameStamp;duration:number;prewarm:number;rate:number;bursts:{time:number|FrameStamp;count:number;sizeScale?:number;color?:Color}[];
  cameraContinuation:{padding:number}|null;
  space:"local"|"world";shape:{type:"point"|"box"|"ellipse"|"sphere";size:Vec3};directionMode:"cone"|"radial";direction:Vec3;spreadDegrees:number;
  speed:Range;speedOverLife:Key<number>[];lifetime:Range;startSize:Range;rotation:Range;angularVelocity:Range;acceleration:Vec3;
  sizeOverLife:Key<number>[];color:Color;colorPalette:{color:Color;weight:number}[];colorOverLife:Key<Color>[];billboard:"camera"|"local";blend:"alpha"|"additive";sortMode:"depth"|"sizeAscending";
  animation:{mode:"single"|"random"|"fps"|"lifetime";frame:number;frames:number[];framesPerSecond:number;loop:boolean;randomStart:boolean};
}
export interface ComponentProperties {Camera:Camera;Vignette:Vignette;ViewportFrame:ViewportFrame;SpriteRenderer:SpriteRenderer;SpriteNumberRenderer:SpriteNumberRenderer;SpriteAnimator:SpriteAnimator;OpacityGradient:OpacityGradient;Flicker:Flicker;TransformAnimator:TransformAnimator;TiledSpriteRenderer:TiledSpriteRenderer;GaussianBlur:GaussianBlur;SpriteMotionBlur:SpriteMotionBlur;DirectionalBlur:DirectionalBlur;PlaneRenderer:PlaneRenderer;Transition:Transition;LineRenderer:LineRenderer;ProceduralNoise:ProceduralNoise;DropShadow:DropShadow;Glow:Glow;ParticleEmitter:ParticleEmitter;ParticleMotionBlur:ParticleMotionBlur;AudioPlayer:AudioPlayerComponent;AnimationPlayer:AnimationPlayerComponent;PlayerControls:PlayerControlsComponent}
export type ComponentType=keyof ComponentProperties;
export type ComponentMap={[K in ComponentType]:ComponentProperties[K]&{type:K;enabled:boolean}};
export type Component=ComponentMap[ComponentType];
export interface Entity {id:string;name:string;active:boolean;transform:Transform;components:Component[];children:Entity[]}
export type DeepPartial<T>=T extends number|string|boolean|bigint|symbol|null|undefined?T:T extends (infer U)[]?DeepPartial<U>[]:T extends object?{[K in keyof T]?:DeepPartial<T[K]>}:T;
export type EntityInput=Omit<DeepPartial<Entity>,"id"|"children"|"components">&{id:string;children?:EntityInput[];components?:({[K in ComponentType]:{type:K}&DeepPartial<ComponentProperties[K]>&{enabled?:boolean}}[ComponentType])[]};
export interface SceneData {
  schemaVersion:1;name?:string;referenceFrame?:{width:number;height:number};
  coordinateSystem:{handedness:"left";up:"+Y";forward:"+Z";rotationOrder:"ZXY";rotationUnit:"degrees";referencePixelsPerUnit:number};
  presentation:{referenceAspect:boolean;toggleKey:string;activeCamera:string|null};rendering:{texturePixelsPerUnit:number};
  timeline:{duration:number;frameRate:number;autoplay:boolean;loop:boolean};assets:Record<string,Asset>;root:Entity;reconstruction?:unknown;
  animation?:import("./animation/sequence.js").AnimationData;
}
export interface View {width:number;height:number;aspect:number;worldWidth:number;worldHeight:number;pixelsPerUnit:number;dpr:number}
export interface SpriteState {frame:number;visible:boolean;size:Vec2;rect:Rect}
export interface ParticleState {id:string;birthTime:number;age:number;lifetime:number;frame:number;color:Color;matrix:Matrix;rect:Rect;blurUV:Vec2;localPosition:Vec3;position:Vec3;depth:number;projectedArea:number}
export type MaskParameters=({type:"Glow"}&Pick<Glow,"sigmaWorld"|"threshold"|"softness">)|{type:"DropShadow";sigmaWorld:number};
export type TextureJob={kind:"noise";component:ProceduralNoise}|{kind:"tile";source:PixelImage;asset:SpriteAsset;sigmaWorld:Vec2;resolution:number;repeatY?:boolean}|{kind:"mask";source:PixelImage;asset:SpriteAsset;component:MaskParameters;resolution:number;gain?:number};
export interface RenderObject {id:string;update(scene:import("./scene.js").Scene,view:View):Promise<void>;dispose():void}
export interface Renderer {
  readonly kind:"dom"|"babylon";
  readonly displayName:string;
  objects:RenderObject[];createScene(scene:import("./scene.js").Scene,resources:import("./resources.js").Resources):Promise<void>;
  prepare?(progress:import("./loading-status.js").LoadingProgress):Promise<void>;
  update(scene:import("./scene.js").Scene,view:View):Promise<void>;disposeScene():void;dispose():void;
}
