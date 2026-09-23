const fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
function checkTypes(){
  const root=path.resolve(__dirname,"../src"),errors=[];
  function visitDirectory(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);if(entry.isDirectory()){visitDirectory(file);continue;}if(!file.endsWith(".ts"))continue;
    const text=fs.readFileSync(file,"utf8"),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    function visit(node){if(node.kind===ts.SyntaxKind.AnyKeyword){const {line}=source.getLineAndCharacterOfPosition(node.getStart(source));errors.push(`${file}:${line+1}: Explicit any is forbidden.`);}ts.forEachChild(node,visit);}visit(source);
    if(/@ts-(ignore|nocheck)/.test(text))errors.push(`${file}: Type-check suppression is forbidden.`);
  }}
  visitDirectory(root);if(errors.length)throw new Error(errors.join("\n"));
}
module.exports={checkTypes};
if(require.main===module){
  checkTypes();
  const config=ts.readConfigFile(path.resolve(__dirname,"../tsconfig.json"),ts.sys.readFile);
  const options=ts.parseJsonConfigFileContent(config.config,ts.sys,path.resolve(__dirname,".."));
  const program=ts.createProgram([path.resolve(__dirname,"../tests/fixtures/animation-types.ts")],{...options.options,rootDir:path.resolve(__dirname,".."),noEmit:true});
  const diagnostics=ts.getPreEmitDiagnostics(program);
  if(diagnostics.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:ts.sys.getCurrentDirectory,getCanonicalFileName:f=>f,getNewLine:()=>"\n"}));
  console.log("Runtime type policy and FrameNumber/track type contracts passed.");
}
