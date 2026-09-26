// Canonical scene JSON keeps file paths. Packaging supplies their runtime URLs.
const files=import.meta.webpackContext("../../assets",{recursive:true,regExp:/\.(png|woff2)$/,mode:"sync"});

export function bundledAssets(baseURL:URL,extra:Readonly<Record<string,string>>={}):(url:string)=>string {
  const urls=new Map(files.keys().map(key=>[new URL(`assets/${key.slice(2)}`,baseURL).href,files(key)]));
  for(const [file,url] of Object.entries(extra))urls.set(new URL(file,baseURL).href,url);
  return url=>urls.get(url)||url;
}
