import { Frame, Time, frameRate, type FrameNumber, type FrameRate, type FrameTime, type Rational } from "./time.js";
import { createTrack, type AnimationTrack, type TrackData, type TrackType } from "./tracks.js";
import type { Entity, EntityInput, ComponentType, SceneData } from "../types.js";

export type ObjectReference={entity:string}|{binding:string;descendant?:string};
export type ObjectBinding={id:string;kind:"possessable";target?:ObjectReference}|{id:string;kind:"spawnable";template:EntityInput;parent?:ObjectReference;spawnTrack?:string;idScope?:"instance"|"scene"};
export interface PropertyPath {component:"Entity"|"Transform"|ComponentType;path:string}
/** The non-generic outer container supplies the binding that a track deliberately lacks. */
export interface AnimationBinding {
  id:string;track:string;object:string;property:PropertyPath;
  range?:{start:number;end:number};priority?:number;blend?:"replace"|"additive";weight?:number;completionMode?:"restore"|"keep";enabled?:boolean;
}
export interface SubSequenceSection {
  id:string;sequence:string;range:{start:number;end:number};startOffset?:number;endOffset?:number;firstLoopOffset?:number;
  timeScale?:{numerator:number;denominator:number};loop?:boolean;hierarchicalBias?:number;
  bindingOverrides?:Record<string,ObjectReference>;enabled?:boolean;
}
export interface SequenceData {
  tickResolution:FrameRate;displayRate:FrameRate;playbackRange:{start:number;end:number};
  objects?:ObjectBinding[];bindings?:AnimationBinding[];sequences?:SubSequenceSection[];
}
export interface AnimationData {master:string;tracks:Record<string,TrackData>;sequences:Record<string,SequenceData>}
export interface SpawnSpec {id:string;parent:string;node:Entity;descendants:Map<string,string>}
export interface EvaluatedWrite {entity:string;property:PropertyPath;tokens:readonly string[];trackType:TrackType;value:number|boolean;blend:"replace"|"additive";weight:number;priority:number;order:number}
export interface SequenceEvaluation {spawns:Map<string,SpawnSpec>;writes:EvaluatedWrite[];activeInstances:string[]}
interface CompiledBinding {definition:AnimationBinding;track:AnimationTrack<number|boolean>;entity:string;tokens:string[];start:FrameNumber;end:FrameNumber;order:number}
interface CompiledSpawn {spec:SpawnSpec;gate?:AnimationTrack<number|boolean>}
interface CompiledSection {definition:SubSequenceSection;instance:SequenceInstance;start:FrameNumber;end:FrameNumber;innerStart:FrameNumber;innerEnd:FrameNumber;firstOffset:FrameNumber;scale:Rational;bias:number}
interface SequenceInstance {id:string;definition:SequenceData;rate:FrameRate;start:FrameNumber;end:FrameNumber;objects:Map<string,string>;spawns:CompiledSpawn[];bindings:CompiledBinding[];sections:CompiledSection[]}
export interface SequenceHost {data:SceneData;nodes:Map<string,Entity>;normalizeTemplate(template:EntityInput):Entity}
const ZERO=Time.fromFrame(Frame.zero),plainObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const checkInt=(n:number,label:string)=>{if(!Number.isSafeInteger(n))throw new Error(`${label} must be an integer.`);return n;};
function range(value:{start:number;end:number},label:string):[FrameNumber,FrameNumber]{const start=Frame.from(value.start),end=Frame.from(value.end);if(Frame.compare(start,end)>=0)throw new Error(`${label} is empty.`);return [start,end];}
function names<T extends {id:string}>(items:readonly T[],label:string):void {const seen=new Set<string>();for(const x of items){if(!x.id||seen.has(x.id))throw new Error(`Duplicate or empty ${label} ID: ${x.id}`);seen.add(x.id);}}
export function propertyRoot(entity:Entity,component:PropertyPath["component"]):object {
  if(component==="Entity")return entity;if(component==="Transform")return entity.transform;
  const c=entity.components.find(c=>c.type===component);if(!c)throw new Error(`Missing ${component} on ${entity.id}.`);return c;
}
export function readProperty(root:object,tokens:readonly string[]):unknown {let value:unknown=root;for(const token of tokens){if(!plainObject(value)&&!Array.isArray(value))throw new Error(`Invalid animation property: ${tokens.join(".")}`);if(!Object.hasOwn(value,token))throw new Error(`Unknown animation property: ${tokens.join(".")}`);value=(value as Record<string,unknown>)[token];}return value;}
export function writeProperty(root:object,tokens:readonly string[],value:number|boolean):void {let object=root as Record<string,unknown>;for(const token of tokens.slice(0,-1))object=object[token] as Record<string,unknown>;object[tokens.at(-1)!]=value;}

/** Compiled hierarchy. Sampling is stateless: arbitrary seeks produce the same spawn set and writes. */
export class SequenceRuntime {
  readonly tracks=new Map<string,AnimationTrack<number|boolean>>();
  readonly master:SequenceInstance;
  readonly templates=new Map<string,Entity>();
  readonly instanceCount:number;
  private order=0;
  private instances=0;
  constructor(readonly data:AnimationData,host:SequenceHost){
    if(!data||!data.tracks||!data.sequences||!data.sequences[data.master])throw new Error("Animation needs a valid master sequence.");
    for(const [id,track] of Object.entries(data.tracks))this.tracks.set(id,createTrack(track));
    const allNodes=new Map(host.nodes);
    const compile=(id:string,instanceId:string,stack:string[],overrides:Record<string,ObjectReference>={},parentObjects=new Map<string,string>()):SequenceInstance=>{
      if(stack.includes(id))throw new Error(`Cyclic sequence nesting: ${[...stack,id].join(" -> ")}`);
      if(stack.length>=32||++this.instances>4096)throw new Error("Sequence hierarchy exceeds its instance budget.");
      const definition=data.sequences[id];if(!definition)throw new Error(`Unknown sequence: ${id}`);
      const rate=frameRate(definition.tickResolution.numerator,definition.tickResolution.denominator);frameRate(definition.displayRate.numerator,definition.displayRate.denominator);
      const [start,end]=range(definition.playbackRange,`Sequence ${id}`),objects=new Map<string,string>(),objectData=definition.objects||[];
      names(objectData,"object binding");names(definition.bindings||[],"animation binding");names(definition.sequences||[],"subsequence");
      for(const key of Object.keys(overrides))if(!objectData.some(x=>x.id===key))throw new Error(`Unknown binding override: ${key}`);
      const instance:SequenceInstance={id:instanceId,definition,rate,start,end,objects,spawns:[],bindings:[],sections:[]};
      const pending=new Map(objectData.map(o=>[o.id,o])),resolving=new Set<string>(),spawnRoots=new Map<string,SpawnSpec>();
      const resolveReference=(ref:ObjectReference,scope=objects):string=>{
        if("entity" in ref){if(!host.nodes.has(ref.entity))throw new Error(`Unknown possessed entity: ${ref.entity}`);return ref.entity;}
        const base=scope===objects?resolve(ref.binding):scope.get(ref.binding);if(!base)throw new Error(`Unknown object binding: ${ref.binding}`);
        if(!ref.descendant)return base;
        const descendant=ref.descendant,root=allNodes.get(base);let result:string|undefined;
        const visit=(n:Entity)=>{if(n.id===descendant||n.id.endsWith("/"+encodeURIComponent(descendant)))result=n.id;n.children.forEach(visit);};if(root)visit(root);
        if(!result)throw new Error(`Unknown bound descendant: ${ref.descendant}`);return result;
      };
      const resolve=(objectId:string):string=>{
        const cached=objects.get(objectId);if(cached)return cached;
        const binding=pending.get(objectId);if(!binding)throw new Error(`Unknown object slot: ${objectId}`);
        if(resolving.has(objectId))throw new Error(`Cyclic object binding: ${objectId}`);resolving.add(objectId);
        let target:string;
        if(overrides[objectId])target=resolveReference(overrides[objectId],parentObjects);
        else if(binding.kind==="possessable"){
          if(!binding.target)throw new Error(`Unbound possessable: ${objectId}`);target=resolveReference(binding.target);
        }else if(binding.kind==="spawnable"){
          if(binding.idScope!==undefined&&binding.idScope!=="instance"&&binding.idScope!=="scene")throw new Error("Unknown spawn ID scope.");
          const node=host.normalizeTemplate(binding.template),descendants=new Map<string,string>();
          const prefix=`__sequence__/${instanceId}/${encodeURIComponent(objectId)}`;
          const rename=(n:Entity)=>{const name=n.id;n.id=binding.idScope==="scene"?name:`${prefix}/${encodeURIComponent(name)}`;if(allNodes.has(n.id))throw new Error(`Spawn ID collision: ${n.id}`);descendants.set(name,n.id);allNodes.set(n.id,n);this.templates.set(n.id,n);n.children.forEach(rename);};rename(node);target=node.id;
          // Component references inside a prefab follow this exact instance.
          const remap=(n:Entity)=>{for(const c of n.components)if(c.type==="Transition"&&c.target){const id=descendants.get(c.target.entity);if(id)c.target.entity=id;}n.children.forEach(remap);};remap(node);
          const spec:SpawnSpec={id:target,parent:host.data.root.id,node,descendants};spawnRoots.set(objectId,spec);
          const gate=binding.spawnTrack?this.tracks.get(binding.spawnTrack):undefined;
          if(binding.spawnTrack&&gate?.type!=="AnimationTrackBoolean")throw new Error("Spawn tracks must be AnimationTrackBoolean.");
          instance.spawns.push({spec,gate});
        }else throw new Error("Unsupported object binding kind.");
        objects.set(objectId,target);resolving.delete(objectId);return target;
      };
      for(const object of objectData)resolve(object.id);
      for(const object of objectData)if(object.kind==="spawnable"&&spawnRoots.has(object.id)&&object.parent)spawnRoots.get(object.id)!.parent=resolveReference(object.parent);
      for(const binding of definition.bindings||[]){
        const track=this.tracks.get(binding.track);if(!track)throw new Error(`Unknown animation track: ${binding.track}`);
        const entity=objects.get(binding.object);if(!entity)throw new Error(`Unknown bound object: ${binding.object}`);
        const node=allNodes.get(entity)!;const tokens=binding.property.path.split(".");
        if(tokens.some(t=>!t||["__proto__","prototype","constructor","type","asset","id","name","children","components"].includes(t)||!/^[A-Za-z_][A-Za-z_0-9]*$|^\d+$/.test(t)))throw new Error("Animation paths must address existing scalar properties.");
        if(binding.property.component==="Entity"&&binding.property.path!=="active")throw new Error("Entity tracks can animate active only.");
        if(binding.property.component==="AudioPlayer"||binding.property.component==="AnimationPlayer"||binding.property.component==="PlayerControls")throw new Error("Transport components use the clock API; transport automation tracks are not supported.");
        const value=readProperty(propertyRoot(node,binding.property.component),tokens),boolean=typeof value==="boolean";
        if(!boolean&&typeof value!=="number")throw new Error("Tracks can bind only numeric or boolean properties.");
        if(boolean!==(track.type==="AnimationTrackBoolean"))throw new Error("Animation track type does not match the property.");
        if(/(^|\.)(frame|maxParticles|seed|textureSize\.[xy])$/.test(binding.property.path)&&track.type!=="AnimationTrackInt32")throw new Error("Integer properties need AnimationTrackInt32.");
        const weight=binding.weight??1;if(!Number.isFinite(weight)||weight<0||weight>1)throw new Error("Animation weight must be in [0,1].");
        if(binding.blend&&!['replace','additive'].includes(binding.blend))throw new Error("Unknown animation blend mode.");
        if(boolean&&(weight!==1||binding.blend==="additive"))throw new Error("Boolean tracks cannot be blended.");
        if(binding.completionMode&&!['restore','keep'].includes(binding.completionMode))throw new Error("Unknown completion mode.");
        checkInt(binding.priority??0,"Binding priority");
        const [first,last]=binding.range?range(binding.range,"Animation binding"):[start,end];
        instance.bindings.push({definition:binding,track,entity,tokens,start:first,end:last,order:this.order++});
      }
      for(const section of definition.sequences||[]){
        const child=compile(section.sequence,`${instanceId}/${encodeURIComponent(section.id)}`,[...stack,id],section.bindingOverrides,objects),[first,last]=range(section.range,"Subsequence section");
        const innerStart=Frame.add(child.start,Frame.from(section.startOffset??0)),innerEnd=Frame.subtract(child.end,Frame.from(section.endOffset??0));
        if(Frame.compare(innerStart,innerEnd)>=0)throw new Error("Subsequence offsets remove the playback range.");
        const speed=section.timeScale??{numerator:1,denominator:1};checkInt(speed.numerator,"Time scale numerator");checkInt(speed.denominator,"Time scale denominator");if(speed.denominator<=0)throw new Error("Time scale denominator must be positive.");
        instance.sections.push({definition:section,instance:child,start:first,end:last,innerStart,innerEnd,firstOffset:Frame.from(section.firstLoopOffset??0),scale:Time.rational(BigInt(speed.numerator),BigInt(speed.denominator)),bias:checkInt(section.hierarchicalBias??100,"Hierarchical bias")});
      }
      return instance;
    };
    this.master=compile(data.master,encodeURIComponent(data.master),[]);this.instanceCount=this.instances;
    // Spawn parenting must remain acyclic, including sibling/descendant references.
    const parents=new Map<string,string>();const visit=(i:SequenceInstance)=>{for(const {spec} of i.spawns){parents.set(spec.id,spec.parent);const children=(n:Entity)=>{for(const c of n.children){parents.set(c.id,n.id);children(c);}};children(spec.node);}i.sections.forEach(s=>visit(s.instance));};visit(this.master);
    for(const id of parents.keys()){const seen=new Set<string>();let current:string|undefined=id;while(current&&parents.has(current)){if(seen.has(current))throw new Error("Cyclic spawn parenting.");seen.add(current);current=parents.get(current);}}
  }
  get tickResolution():FrameRate{return this.master.rate;}
  get displayRate():FrameRate{return this.master.definition.displayRate;}
  /** Bound a numeric property over every reachable binding, without frame sampling. */
  propertyBounds(entity:string,property:PropertyPath,initial:number):{min:number;max:number} {
    let min=initial,max=initial,addMin=0,addMax=0;
    const visit=(instance:SequenceInstance)=>{
      for(const binding of instance.bindings){
        const d=binding.definition;
        if(d.enabled===false||binding.entity!==entity||d.property.component!==property.component||d.property.path!==property.path)continue;
        const bounds=binding.track.valueBounds(instance.rate);if(!bounds)continue;
        const weight=d.weight??1;
        if(d.blend==="additive"){addMin+=Math.min(0,bounds.min*weight);addMax+=Math.max(0,bounds.max*weight);}
        else {min=Math.min(min,bounds.min);max=Math.max(max,bounds.max);}
      }
      for(const section of instance.sections)if(section.definition.enabled!==false)visit(section.instance);
    };
    visit(this.master);return {min:min+addMin,max:max+addMax};
  }
  fromSeconds(seconds:number):FrameTime{return Time.add(Time.fromFrame(this.master.start),Time.fromSeconds(seconds,this.master.rate));}
  evaluate(time:FrameTime):SequenceEvaluation {
    const result:SequenceEvaluation={spawns:new Map(),writes:[],activeInstances:[]};
    const within=(t:FrameTime,start:FrameNumber,end:FrameNumber)=>Time.compare(t,Time.fromFrame(start))>=0&&Time.compare(t,Time.fromFrame(end))<0;
    const sample=(instance:SequenceInstance,local:FrameTime,bias:number)=>{
      if(!within(local,instance.start,instance.end))return;result.activeInstances.push(instance.id);
      for(const {spec,gate} of instance.spawns)if(!gate||gate.evaluate(local,instance.rate))result.spawns.set(spec.id,spec);
      for(const binding of instance.bindings){
        const d=binding.definition;if(d.enabled===false||Time.compare(local,Time.fromFrame(binding.start))<0)continue;
        let t=local;if(Time.compare(local,Time.fromFrame(binding.end))>=0){if(d.completionMode!=="keep")continue;t=Time.fromFrame(binding.end);}
        const value=binding.track.evaluate(t,instance.rate);if(value===undefined)continue;
        result.writes.push({entity:binding.entity,property:d.property,tokens:binding.tokens,trackType:binding.track.type,value,priority:bias+(d.priority??0),order:binding.order,blend:d.blend??"replace",weight:d.weight??1});
      }
      for(const section of instance.sections){
        const d=section.definition;if(d.enabled===false||!within(local,section.start,section.end))continue;
        const elapsed=Time.convert(Time.subtract(local,Time.fromFrame(section.start)),instance.rate,section.instance.rate);
        let inner=Time.add(Time.fromFrame(section.innerStart),Time.scale(elapsed,section.scale));
        inner=Time.add(inner,Time.fromFrame(section.firstOffset));
        if(d.loop)inner=Time.wrap(inner,section.innerStart,section.innerEnd);
        else if(!within(inner,section.innerStart,section.innerEnd))continue;
        sample(section.instance,inner,bias+section.bias);
      }
    };
    if(Time.compare(time,ZERO)>=0||Frame.compare(this.master.start,Frame.zero)<0)sample(this.master,time,0);
    result.writes.sort((a,b)=>a.priority-b.priority||a.order-b.order);return result;
  }
}
