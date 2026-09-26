import { Math3D as M } from "./math.js";
import { normalizeScene, merge } from "./components.js";
import { sampleKeys, particleStates } from "./particles.js";
import { spriteRect } from "./atlas.js";
import { flickerVisible } from "./flicker.js";
import { applyTransformNoise } from "./transform-noise.js";
import { SequenceRuntime, propertyRoot, readProperty, writeProperty, type SequenceEvaluation } from "./animation/sequence.js";
import { Frame, Time, frameRate, type FrameTime, type FrameRate } from "./animation/time.js";
import type { SceneData, Entity, EntityInput, Component, ComponentType, ComponentMap, DeepPartial, Transform, Matrix, View, Vec3, Bounds, SpriteState, SpriteAsset, AudioAsset } from "./types.js";

export class Scene {
  readonly baseURL:string;
  data:SceneData;original:SceneData;
  readonly nodes=new Map<string,Entity>();readonly parents=new Map<string,Entity|null>();readonly world=new Map<string,Matrix>();readonly active=new Map<string,boolean>();
  readonly authoredNodes=new Map<string,Entity>();
  private overlays=new Map<string,Entity>();private snapshot?:SequenceEvaluation;
  animationEnabled=true;
  private seconds=0;private exactTime?:FrameTime;private timelinePosition=Time.fromFrame(Frame.zero);
  private cameraWorld?:Matrix;private inverseCamera?:Matrix;
  private viewport?:Pick<View,"worldWidth"|"worldHeight">;
  cameraNode!:Entity;sequence?:SequenceRuntime;
  /** World matrices are replaced on evaluation. Invert the active camera only
   * once for all surfaces/particles in that evaluation, including camera cuts. */
  get viewMatrix():Matrix {
    const world=this.world.get(this.cameraNode.id)!;
    if(world!==this.cameraWorld){this.cameraWorld=world;this.inverseCamera=M.inverse(world);}
    return this.inverseCamera!;
  }
  constructor(data:unknown,baseURL:string,private readonly resolveAsset:(url:string)=>string=url=>url){this.baseURL=baseURL;this.data=normalizeScene(data);this.original=structuredClone(this.data);this.index();this.compileAnimation();this.updateWorld();}
  get time():number{return this.seconds;}
  set time(value:number){if(!Number.isFinite(value)||value<0)throw new Error("Scene time must be finite and nonnegative.");this.seconds=value;this.timelinePosition=Time.fromDecimal(value);this.exactTime=undefined;}
  /** Rational seconds, retained even when the scene has no master sequence. */
  get timelineTime():FrameTime{return this.timelinePosition;}
  setFrameTime(value:FrameTime,rate:FrameRate):void {
    this.timelinePosition=Time.convert(value,rate,frameRate(1));
    this.exactTime=this.sequence?Time.add(Time.fromFrame(this.sequence.master.start),Time.convert(value,rate,this.sequence.tickResolution)):undefined;
    this.seconds=Time.toSeconds(value,rate);
  }
  get frameTime():FrameTime|undefined{return this.sequence?(this.exactTime||this.sequence.fromSeconds(this.time)):undefined;}
  get animationPlayer():ComponentMap["AnimationPlayer"]|undefined {
    let selected:ComponentMap["AnimationPlayer"]|undefined;
    const visit=(node:Entity,active:boolean)=>{active&&=node.active;if(active){const player=node.components.find(c=>c.type==="AnimationPlayer"&&c.enabled);if(player){if(selected)throw new Error("A scene supports one active AnimationPlayer transport; nest sequences inside it.");selected=player as ComponentMap["AnimationPlayer"];}node.children.forEach(child=>visit(child,active));}};
    visit(this.data.root,true);return selected;
  }
  private compileAnimation():void {const animation=this.data.animation,player=this.animationPlayer;this.sequence=animation?new SequenceRuntime({...animation,master:player?.sequence||animation.master},{data:this.data,nodes:this.authoredNodes,normalizeTemplate:template=>this.normalizeTemplate(template)}):undefined;if(this.sequence){this.data.timeline.duration=Time.toSeconds(Time.subtract(Time.fromFrame(this.sequence.master.end),Time.fromFrame(this.sequence.master.start)),this.sequence.tickResolution);this.data.timeline.frameRate=this.sequence.displayRate.numerator/this.sequence.displayRate.denominator;}}
  private normalizeTemplate(template:EntityInput):Entity {
    const ids=new Set<string>();const visit=(node:EntityInput)=>{if(node.components?.some(c=>c.type==="AudioPlayer"||c.type==="AnimationPlayer"||c.type==="PlayerControls"))throw new Error("Player components must be authored entities, not spawnable templates.");ids.add(node.id);node.children?.forEach(visit);};visit(template);
    const unique=(name:string)=>{while(ids.has(name))name+="_";ids.add(name);return name;};
    const root={id:unique("template-root"),children:[{id:unique("template-camera"),components:[{type:"Camera"}]},template]};
    return normalizeScene({...this.data,animation:undefined,presentation:{...this.data.presentation,activeCamera:null},root}).root.children[1];
  }
  index():void {
    const nodes=new Map<string,Entity>(),parents=new Map<string,Entity|null>(),authored=new Map<string,Entity>();
    const visit=(node:Entity,parent:Entity|null,isAuthored:boolean)=>{nodes.set(node.id,node);parents.set(node.id,parent);if(isAuthored)authored.set(node.id,node);node.children.forEach(n=>visit(n,node,isAuthored));};visit(this.data.root,null,true);
    if(this.snapshot){const pending=[...this.snapshot.spawns.values()];let changed=true;while(changed&&pending.length){changed=false;for(let i=pending.length-1;i>=0;i--){const s=pending[i],parent=nodes.get(s.parent);if(parent){visit(s.node,parent,false);pending.splice(i,1);changed=true;}}}}
    // Preserve insertion order and active iterators when editing existing entities.
    // Clearing/reinserting a Map during an editor's traversal can loop forever.
    const reconcile=<T>(current:Map<string,T>,next:Map<string,T>)=>{for(const id of current.keys())if(!next.has(id))current.delete(id);for(const [id,value] of next)current.set(id,value);};
    reconcile(this.nodes,nodes);reconcile(this.parents,parents);reconcile(this.authoredNodes,authored);
  }
  find(id:string):Entity {const node=this.nodes.get(id);if(!node)throw new Error(`Unknown entity: ${id}`);return node;}
  /** All declarations, including descendants of future nested spawnables. */
  *declaredEntities():IterableIterator<Entity>{
    yield* this.authoredNodes.values();
    if(this.sequence)yield* this.sequence.templates.values();
  }
  /** An entity outside its owning sequence does not exist and is inactive. */
  isActive(id:string):boolean{return this.active.get(id)??false;}
  component<K extends ComponentType>(id:string,type:K):ComponentMap[K]|undefined {return (this.overlays.get(id)||this.find(id)).components.find(c=>c.type===type) as ComponentMap[K]|undefined;}
  requireComponent<K extends ComponentType>(id:string,type:K):ComponentMap[K] {const component=this.component(id,type);if(!component)throw new Error(`Missing ${type} on ${id}.`);return component;}
  /** Nearest enabled sprite sorting group. Projection and depth tests still
   * use each member's real world matrix; only alpha draw order is grouped. */
  spriteSortAnchor(id:string):Vec3|undefined {
    let node:Entity|null|undefined=this.find(id);
    while(node){const group=this.component(node.id,"SortingGroup");if(group?.enabled)return M.point(this.world.get(node.id)!,group.anchor);node=this.parents.get(node.id);}
    return undefined;
  }
  asset(id:string):SpriteAsset {const a=this.data.assets[id];if(a?.type!=="Sprite")throw new Error(`Unknown Sprite asset: ${id}`);return a;}
  audioAsset(id:string):AudioAsset {const a=this.data.assets[id];if(a?.type!=="Audio")throw new Error(`Unknown Audio asset: ${id}`);return a;}
  fontAsset(id:string):import("./types.js").FontAsset {const a=this.data.assets[id];if(a?.type!=="Font")throw new Error(`Unknown Font asset: ${id}`);return a;}
  source(id:string):string{const a=this.data.assets[id];if(!a)throw new Error(`Unknown asset: ${id}`);return this.resolveAsset(new URL(a.file,this.baseURL).href);}
  spriteState(id:string):SpriteState {
    const sprite=this.component(id,"SpriteRenderer")||this.requireComponent(id,"TiledSpriteRenderer"),asset=this.asset(sprite.asset),atlas=asset.atlas,animation=this.component(id,"SpriteAnimator");
    let frame=sprite.frame,visible=sprite.enabled;
    if(animation?.enabled&&atlas){
      const count=animation.frames.length||atlas.frameCount,elapsed=Time.subtract(this.timelineTime,Time.convert(Time.fromFrame(animation.start.frame),animation.start.rate,frameRate(1)));
      const step=Time.floor(Time.scale(elapsed,Time.decimal(animation.framesPerSecond))),outside=step<0||(!animation.loop&&step>=count);
      visible &&= !animation.hideOutside||!outside;
      const index=animation.loop&&step>=0?step%count:Math.max(0,Math.min(count-1,step));frame=animation.frames.length?animation.frames[index]:index;
    }
    return {frame,visible,size:atlas?.cellSize||asset.size,rect:spriteRect(asset,frame)};
  }
  animationSignature():string {if(this.sequence)return `${this.animationEnabled}:${Time.key(this.frameTime!)}`;return [...this.nodes.values()].map(n=>{if(n.components.some(c=>c.enabled&&(c.type==="ParticleEmitter"||c.type==="TransformAnimator"||c.type==="TransformNoise"||c.type==="ScanlineJitter"&&c.amplitudeWorld>0)))return `${n.id}:${Time.key(this.timelineTime)}`;let key="";if(this.component(n.id,"SpriteAnimator")?.enabled){const s=this.spriteState(n.id);key=`${n.id}:${s.frame}:${s.visible}`;}const flicker=this.component(n.id,"Flicker");if(flicker?.enabled)key+=`${n.id}:flicker:${flickerVisible(flicker,this.timelineTime)}`;return key;}).join("|");}
  private baseTransform(node:Entity,time:number):Transform {const a=node.components.find(c=>c.type==="TransformAnimator"),t=node.transform;if(!a?.enabled)return t;return {localPosition:sampleKeys(a.position,time,t.localPosition),localRotation:sampleKeys(a.rotation,time,t.localRotation),localScale:sampleKeys(a.scale,time,t.localScale)};}
  private evaluateOverlays(snapshot:SequenceEvaluation|undefined,time:number):Map<string,Entity> {
    const result=new Map<string,Entity>();
    for(const w of snapshot?.writes||[]){
      const base=this.nodes.get(w.entity)||this.sequence?.templates.get(w.entity);if(!base)continue;
      let entity=result.get(w.entity);if(!entity){entity={...base,transform:structuredClone(this.baseTransform(base,time)),components:structuredClone(base.components)};result.set(w.entity,entity);}
      const root=propertyRoot(entity,w.property.component),old=readProperty(root,w.tokens);
      let value=typeof w.value==="boolean"?w.value:w.blend==="additive"?Number(old)+w.value*w.weight:Number(old)*(1-w.weight)+w.value*w.weight;
      if(typeof value==="number"&&!Number.isFinite(value))throw new Error("Animated values must be finite.");
      if(w.property.component==="Transform"&&w.tokens[0]==="localScale"&&value===0)throw new Error("An animated Transform scale cannot be zero.");
      if(w.trackType==="AnimationTrackInt32"&&typeof value==="number")value=Math.max(Frame.min,Math.min(Frame.max,Math.round(value)));
      if((w.property.component==="SpriteRenderer"||w.property.component==="TiledSpriteRenderer")&&w.property.path==="frame"){
        const sprite=entity.components.find(c=>c.type==="SpriteRenderer"||c.type==="TiledSpriteRenderer")!;
        if(typeof value!=="number"||value<0||value>=(this.asset(sprite.asset).atlas?.frameCount||1))throw new Error(`Animated sprite frame outside atlas: ${entity.id}`);
      }
      writeProperty(root,w.tokens,value);
    }
    return result;
  }
  transformAt(id:string,time:FrameTime|number=this.timelineTime):Transform {
    if(time===this.timelineTime||time===this.time){const node=this.overlays.get(id)||this.find(id),transform=this.overlays.get(id)?.transform||this.baseTransform(node,this.time),noise=node.components.find(c=>c.type==="TransformNoise");return this.anchorTransform(node,noise?.enabled?applyTransformNoise(transform,noise,this.timelineTime):transform);}
    const seconds=typeof time==="number"?time:Time.toDecimal(time),sequence=this.sequence;
    const phase=sequence?(typeof time==="number"?sequence.fromSeconds(time):Time.add(Time.fromFrame(sequence.master.start),Time.convert(time,frameRate(1),sequence.tickResolution))):undefined;
    const overlay=this.animationEnabled&&sequence?this.evaluateOverlays(sequence.evaluate(phase!),seconds).get(id):undefined;
    const node=overlay||this.find(id),transform=overlay?.transform||this.baseTransform(node,seconds),noise=node.components.find(c=>c.type==="TransformNoise");
    return this.anchorTransform(node,noise?.enabled?applyTransformNoise(transform,noise,typeof time==="number"?Time.fromDecimal(time):time):transform);
  }
  private anchorTransform(node:Entity,transform:Transform):Transform {
    const anchor=node.components.find(c=>c.type==="ViewportAnchor");if(!anchor?.enabled||!this.viewport)return transform;
    const parent=this.parents.get(node.id),camera=parent?this.component(parent.id,"Camera"):undefined;
    if(!camera)throw new Error(`ViewportAnchor requires a Camera parent: ${node.id}`);
    const p=transform.localPosition,referenceHeight=camera.referenceVerticalSize;
    const scale=camera.projection==="perspective"?p.z/(referenceHeight/(2*Math.tan(camera.verticalFovDegrees*Math.PI/360))):1;
    return {...transform,localPosition:{x:p.x+(anchor.position.x-.5)*(this.viewport.worldWidth-referenceHeight*camera.referenceAspect)*scale,y:p.y+(anchor.position.y-.5)*(this.viewport.worldHeight-referenceHeight)*scale,z:p.z}};
  }
  matrixAt(id:string,time:FrameTime|number=this.timelineTime):Matrix {
    const current=time===this.timelineTime||time===this.time,seconds=typeof time==="number"?time:Time.toDecimal(time),exact=typeof time==="number"?Time.fromDecimal(time):time,sequence=this.sequence;
    const phase=sequence?(typeof time==="number"?sequence.fromSeconds(time):Time.add(Time.fromFrame(sequence.master.start),Time.convert(time,frameRate(1),sequence.tickResolution))):undefined;
    // A hierarchy sample evaluates its sequence once, not once per ancestor.
    const overlays=current?this.overlays:this.animationEnabled&&sequence?this.evaluateOverlays(sequence.evaluate(phase!),seconds):undefined;
    const chain:Entity[]=[];let node:Entity|null|undefined=this.find(id);
    while(node){chain.push(node);node=this.parents.get(node.id);}
    let matrix=M.identity();
    for(let i=chain.length-1;i>=0;i--){
      const base=chain[i],overlay=overlays?.get(base.id),entity=overlay||base,noise=entity.components.find(c=>c.type==="TransformNoise");
      let transform=overlay?.transform||this.baseTransform(base,seconds);if(noise?.enabled)transform=applyTransformNoise(transform,noise,exact);
      transform=this.anchorTransform(entity,transform);
      matrix=M.multiply(matrix,M.trs(transform));
    }
    return matrix;
  }
  particleStates(id:string,time:FrameTime|number=this.timelineTime,view?:Pick<View,"worldWidth"|"worldHeight">){return particleStates(this,id,time,view);}
  updateWorld():void {
    this.snapshot=this.animationEnabled?this.sequence?.evaluate(this.frameTime!):undefined;this.index();this.overlays=this.evaluateOverlays(this.snapshot,this.time);this.world.clear();this.active.clear();
    this.updateMatrices();
  }
  /** Resizing changes only layout, never the authored animation time or keys. */
  setViewport(view:Pick<View,"worldWidth"|"worldHeight">):void {
    if(this.viewport?.worldWidth===view.worldWidth&&this.viewport.worldHeight===view.worldHeight)return;
    this.viewport={worldWidth:view.worldWidth,worldHeight:view.worldHeight};this.world.clear();this.active.clear();this.updateMatrices();
  }
  private updateMatrices():void {
    const visit=(id:string):void=>{if(this.world.has(id))return;const parent=this.parents.get(id);if(parent)visit(parent.id);const n=this.overlays.get(id)||this.find(id);this.world.set(id,M.multiply(parent?this.world.get(parent.id)!:M.identity(),M.trs(this.transformAt(id))));const flicker=n.components.find(c=>c.type==="Flicker");this.active.set(id,(parent?this.active.get(parent.id)!:true)&&n.active&&(!flicker?.enabled||flickerVisible(flicker,this.timelineTime)));};for(const id of this.nodes.keys())visit(id);
    const cameras=[...this.nodes.values()].filter(n=>this.active.get(n.id)&&this.component(n.id,"Camera")?.enabled);
    const camera=cameras.find(n=>n.id===this.data.presentation.activeCamera)||cameras[0];if(!camera)throw new Error("The scene has no active Camera.");this.cameraNode=camera;
  }
  export():SceneData{return structuredClone(this.data);}
  setTransform(id:string,values:DeepPartial<Transform>):void {
    const next=merge(structuredClone(this.find(id).transform),values);
    for(const key of ["localPosition","localRotation","localScale"] as const)for(const axis of ["x","y","z"] as const)if(!Number.isFinite(next[key][axis])||(key==="localScale"&&next[key][axis]===0))throw new Error("Invalid Transform.");
    this.find(id).transform=next;this.updateWorld();
  }
  setComponent<K extends ComponentType>(id:string,type:K,values:DeepPartial<ComponentMap[K]>):void {
    const data=this.export(),visit=(n:Entity)=>{if(n.id===id){const c=n.components.find(c=>c.type===type);if(!c)throw new Error(`Missing ${type} on ${id}`);merge(c,values);}n.children.forEach(visit);};
    this.find(id);visit(data.root);const checked=normalizeScene(data);
    const copy=(n:Entity)=>{this.find(n.id).components=n.components;n.children.forEach(copy);};copy(checked.root);this.compileAnimation();this.updateWorld();
  }
  cssMatrix(id:string,view:View,offset={x:0,y:0,z:0},units=view.pixelsPerUnit){
    const local=M.identity();local[12]=offset.x;local[13]=offset.y;local[14]=offset.z;
    return `matrix3d(${this.cssProjection(M.multiply(this.world.get(id)!,local),view,{x:units,y:units,z:units}).join(",")})`;
  }
  /** Reference-aspect projection normalization; aspect expansion exposes more
   * of the same scene without changing its screen scale. */
  get projectionDistance():number {const c=this.requireComponent(this.cameraNode.id,"Camera");return c.referenceVerticalSize/(2*Math.tan(c.verticalFovDegrees*Math.PI/360));}
  get projectionOffset():{x:number;y:number} {const c=this.requireComponent(this.cameraNode.id,"Camera");return c.projection==="perspective"?{x:(c.principalPoint.x-.5)*c.referenceVerticalSize*c.referenceAspect,y:(.5-c.principalPoint.y)*c.referenceVerticalSize}:{x:0,y:0};}
  frustumScale(depth:number):number {return this.requireComponent(this.cameraNode.id,"Camera").projection==="perspective"?depth/this.projectionDistance:1;}
  projectCameraPoint(p:Vec3):Vec3 {const s=this.frustumScale(p.z),o=this.projectionOffset;return {x:p.x/s+o.x,y:p.y/s+o.y,z:p.z};}
  cssProjection(world:Matrix,view:View,units:Vec3):Matrix {
    const flip=[1,0,0,0,0,-1,0,0,0,0,-1,0,0,0,0,1];
    const matrix=M.multiply(M.multiply(flip,M.multiply(this.viewMatrix,world)),flip),u=[units.x,units.y,units.z];
    for(let col=0;col<3;col++)for(let row=0;row<3;row++)matrix[col*4+row]*=view.pixelsPerUnit/u[col];
    for(let row=0;row<3;row++)matrix[12+row]*=view.pixelsPerUnit;
    if(this.requireComponent(this.cameraNode.id,"Camera").projection==="perspective"){
      // CSS homogeneous W performs perspective on each flat retained surface.
      const distance=this.projectionDistance*view.pixelsPerUnit;
      for(let col=0;col<4;col++)matrix[col*4+3]=-matrix[col*4+2]/distance;
      // Retain an invertible CSS perspective matrix. Making Z proportional to
      // W collapses the determinant; Gecko correctly discards that transform.
      matrix[14]+=distance;
      const offset=this.projectionOffset;
      for(let col=0;col<4;col++){matrix[col*4]+=offset.x*view.pixelsPerUnit*matrix[col*4+3];matrix[col*4+1]-=offset.y*view.pixelsPerUnit*matrix[col*4+3];}
    }
    return matrix;
  }
  coverage(id:string,view:Pick<View,"worldWidth"|"worldHeight">,padding=.1){
    // Intersect the finite near/far frustum with local Z=0. Infinite corner rays
    // explode as a plane becomes edge-on; the twelve finite edges never do.
    const m=M.multiply(M.inverse(this.world.get(id)!),this.world.get(this.cameraNode.id)!),c=this.requireComponent(this.cameraNode.id,"Camera");
    const vertices:Vec3[]=[],points:Vec3[]=[];
    const offset=this.projectionOffset;
    for(const z of [c.near,c.far])for(const y of [-view.worldHeight/2,view.worldHeight/2])for(const x of [-view.worldWidth/2,view.worldWidth/2]){const scale=this.frustumScale(z);vertices.push(M.point(m,{x:(x-offset.x)*scale,y:(y-offset.y)*scale,z}));}
    for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit)){
      const a=vertices[i],b=vertices[i|bit];
      if(Math.abs(a.z)<1e-10)points.push(a);if(Math.abs(b.z)<1e-10)points.push(b);
      if(a.z*b.z<0){const t=a.z/(a.z-b.z);points.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:0});}
    }
    if(points.length<3)return null;
    return {left:Math.min(...points.map(p=>p.x))-padding,right:Math.max(...points.map(p=>p.x))+padding,bottom:Math.min(...points.map(p=>p.y))-padding,top:Math.max(...points.map(p=>p.y))+padding};
  }
  clipPlane(id:string,view:View,bounds:Bounds,offsetZ=0,origin={x:0,y:0},units=view.pixelsPerUnit){
    const matrix=M.multiply(this.viewMatrix,this.world.get(id)!),camera=this.requireComponent(this.cameraNode.id,"Camera");
    let points=[[bounds.left,bounds.bottom],[bounds.right,bounds.bottom],[bounds.right,bounds.top],[bounds.left,bounds.top]].map(([x,y])=>({x,y,z:M.point(matrix,{x,y,z:offsetZ}).z}));
    const inside=points.every(p=>p.z>=camera.near&&p.z<=camera.far);
    for(const [limit,sign] of [[camera.near,1],[camera.far,-1]]){
      const clipped=[];
      for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length],ai=(a.z-limit)*sign>=0,bi=(b.z-limit)*sign>=0;
        if(ai)clipped.push(a);
        if(ai!==bi){const t=(limit-a.z)/(b.z-a.z);clipped.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:limit});}
      }
      points=clipped;
    }
    return {visible:points.length>=3,css:inside?"none":`polygon(${points.map(p=>`${(p.x-origin.x)*units}px ${-(p.y-origin.y)*units}px`).join(",")})`};
  }
}
