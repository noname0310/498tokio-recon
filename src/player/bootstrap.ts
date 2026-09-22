// Keep this entry a classic script so file:// can show setup instructions.
(() => {
  const status=document.getElementById("status");
  if(!status)return;
  if(location.protocol==="file:"){
    status.textContent="Run npm ci, then npm run preview. Open this page at http://127.0.0.1:4980 after the Webpack build completes.";
    return;
  }
  const script=document.currentScript;
  if(!(script instanceof HTMLScriptElement))throw new Error("Missing player bootstrap script.");
  const url=new URL("./player.js",script.src).href;
  import(/* webpackIgnore: true */ url).then((module:typeof import("../runtime/player.js"))=>module.boot()).catch((error:unknown)=>{
    status.textContent=`Could not start the runtime: ${error instanceof Error?error.message:String(error)}`;console.error(error);
  });
})();
