// Canonical scene JSON keeps file paths. Packaging supplies their runtime URLs.
const images=import.meta.webpackContext("../../assets",{recursive:true,regExp:/\.png$/,mode:"sync"});

export function bundledAssets(baseURL:URL,extra:Readonly<Record<string,string>>={}):(url:string)=>string {
  const urls=new Map(images.keys().map(key=>[new URL(`assets/${key.slice(2)}`,baseURL).href,images(key)]));
  for(const [file,url] of Object.entries(extra))urls.set(new URL(file,baseURL).href,url);
  return url=>urls.get(url)||url;
}
