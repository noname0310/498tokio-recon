interface WebpackAssetContext { (key:string):string; keys():string[] }
interface ImportMeta {
  webpackContext(directory:string,options:{recursive:boolean;regExp:RegExp;mode:"sync"}):WebpackAssetContext;
}
declare module "*.mp3" {const url:string;export default url;}
declare module "*.json" {const data:unknown;export default data;}
declare module "*?inline-worker" {export default class InlineWorker extends Worker {constructor();}}
