// Preview the Webpack artifact; tests can supply additional static mounts.
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),{spawn}=require("node:child_process");
const root=path.resolve(__dirname,".."),port=Number(process.env.TOKIO_PREVIEW_PORT||4980);
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".mp4":"video/mp4",".mp3":"audio/mpeg"};
function makeServer({mounts=[],basePath="/"}={}){
  const prefix="/"+basePath.split("/").filter(Boolean).join("/");
  const mount=prefix==="/"?"/":prefix+"/";
  return http.createServer((req,res)=>{
  if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405,{Allow:"GET, HEAD"});res.end();return;}
  let relative,url;try{url=new URL(req.url,"http://localhost");relative=decodeURIComponent(url.pathname);}catch{res.writeHead(400);res.end();return;}
  if(relative===prefix&&prefix!=="/"){res.writeHead(302,{Location:mount+url.search});res.end();return;}
  if(!relative.startsWith(mount)){res.writeHead(404);res.end();return;}
  relative="/"+relative.slice(mount.length);
  if(relative.endsWith("/"))relative+="index.html";
  if(relative==="/favicon.ico"){res.writeHead(204);res.end();return;}
  let directory=path.join(root,"dist");
  for(const entry of mounts){
    if(relative.startsWith(entry.prefix)){
      directory=path.resolve(entry.directory);relative="/"+relative.slice(entry.prefix.length);break;
    }
  }
  const file=path.resolve(directory,"."+relative);
  if(!file.startsWith(directory+path.sep)){res.writeHead(403);res.end();return;}
  fs.stat(file,(error,stat)=>{
    if(error||!stat.isFile()){res.writeHead(404);res.end("Not found");return;}
    const headers={"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store","Accept-Ranges":"bytes"};
    let start=0,end=stat.size-1,status=200;
    if(req.headers.range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(match&&(match[1]||match[2])){
        if(match[1]){start=Number(match[1]);end=match[2]?Math.min(end,Number(match[2])):end;}
        else {const suffix=Number(match[2]);start=Math.max(0,stat.size-suffix);if(!Number.isSafeInteger(suffix)||suffix<=0)start=stat.size;}
      }else start=stat.size;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=stat.size||end<start){res.writeHead(416,{...headers,"Content-Range":`bytes */${stat.size}`,"Content-Length":0});res.end();return;}
      status=206;headers["Content-Range"]=`bytes ${start}-${end}/${stat.size}`;
    }
    headers["Content-Length"]=Math.max(0,end-start+1);res.writeHead(status,headers);
    if(req.method==="HEAD"||!stat.size){res.end();return;}
    const stream=fs.createReadStream(file,{start,end});stream.on("error",()=>res.destroy());res.on("close",()=>stream.destroy());stream.pipe(res);
  });
});}
module.exports={makeServer,root};
if(require.main===module){
  if(!fs.existsSync(path.join(root,"dist/index.html")))throw new Error("Missing dist/index.html. Run npm run build first.");
  const server=makeServer(),url=`http://127.0.0.1:${port}/?renderer=dom`;
  server.on("error",error=>{console.error(error.message);process.exitCode=1;});
  server.listen(port,"127.0.0.1",()=>{
    console.log(`Preview: ${url}\nUse renderer=babylon for the other backend. Ctrl+C stops the server.`);
    if(process.argv.includes("--open")){
      if(process.platform==="win32")spawn("powershell.exe",["-NoProfile","-WindowStyle","Hidden","-Command",`Start-Process '${url}'`],{windowsHide:true,stdio:"ignore"}).unref();
      else spawn(process.platform==="darwin"?"open":"xdg-open",[url],{stdio:"ignore"}).unref();
    }
  });
}
