import type * as Babylon from "@babylonjs/core/pure";
import type {BabylonObjectConstructor,BabylonRenderObject,BabylonSceneContext} from "./babylon-context.js";
import type {ComponentType,Entity} from "./types.js";

interface Entry {objects:BabylonRenderObject[];meshes:{mesh:Babylon.AbstractMesh;local:boolean}[]}

/** Dormant render resources are detached from the live scene's mesh list.
 * Sequence ownership remains unchanged, and readiness/sorting never scans the
 * entire movie. Acquiring an entry only reattaches existing GPU objects. */
export class BabylonObjectPool {
  private readonly entries=new Map<string,Entry>();
  constructor(private readonly context:BabylonSceneContext){}
  has(id:string):boolean{return this.entries.has(id);}
  prepare(node:Entity,registry:ReadonlyMap<ComponentType,BabylonObjectConstructor>):void {
    if(this.entries.has(node.id))return;
    const r=this.context,existing=r.nodes.get(node.id),parent=existing??new r.B.TransformNode(node.name,r.scene);
    if(!existing){parent.setEnabled(false);r.nodes.set(node.id,parent);}
    const objects:BabylonRenderObject[]=[];
    try{
      for(const [type,Handler]of registry)if(node.components.some(c=>c.type===type)){
        const object=new Handler(r,node);objects.push(object);object.prepareResources?.(node);
      }
      this.release(node.id,objects);
    }catch(error){objects.forEach(object=>object.dispose());throw error;}
    finally{if(!existing){r.nodes.delete(node.id);parent.dispose(true);}}
  }
  release(id:string,objects:BabylonRenderObject[]):void {
    const r=this.context,parent=r.nodes.get(id),meshes=r.scene.meshes.filter(mesh=>r.entityOwners.get(mesh)===id).map(mesh=>({mesh,local:mesh.parent===parent}));
    for(const object of objects)object.deactivate?.();
    for(const {mesh}of meshes){mesh.setEnabled(false);mesh.parent=null;r.scene.removeMesh(mesh);}
    this.entries.set(id,{objects,meshes});
  }
  acquire(id:string):BabylonRenderObject[]|undefined {
    const entry=this.entries.get(id);if(!entry)return;
    const r=this.context;this.entries.delete(id);
    for(const {mesh,local}of entry.meshes){if(local)mesh.parent=r.nodes.get(id)??null;r.scene.addMesh(mesh);}
    return entry.objects;
  }
  dispose():void {for(const entry of this.entries.values())for(const object of entry.objects)object.dispose();this.entries.clear();}
}
