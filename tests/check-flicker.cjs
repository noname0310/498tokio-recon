const assert=require("node:assert/strict"),path=require("node:path"),{pathToFileURL}=require("node:url");
async function check(){
  const {Scene,flickerVisible,Time,Frame,frameRate}=await import(pathToFileURL(path.resolve(__dirname,"../dist/runtime/player.js")));
  const seconds=(n,rate)=>Time.convert(Time.fromDecimal(n),frameRate(rate),frameRate(1));
  const periodic={mode:"periodic",frequency:15,dutyCycle:.5,probability:.5,seed:49821,start:{frame:Frame.zero,rate:frameRate(30)},phase:0};
  for(let n=0;n<=810;n++)assert.equal(flickerVisible(periodic,seconds(n,30)),n%2===0);
  assert.equal(flickerVisible({...periodic,start:{frame:Frame.from(1),rate:frameRate(1)}},.9),false);assert.equal(flickerVisible({...periodic,start:{frame:Frame.from(1),rate:frameRate(1)}},1),true);
  assert.equal(flickerVisible({...periodic,phase:.5},0),false);
  for(const dutyCycle of [0,1])for(let n=0;n<60;n++)assert.equal(flickerVisible({...periodic,dutyCycle},n/61),Boolean(dutyCycle));
  const random={...periodic,mode:"random"},saved=Math.random;Math.random=()=>{throw new Error("Flicker must use its own seeded generator");};
  try{
    const sequence=Array.from({length:128},(_,i)=>flickerVisible(random,seconds(i,15)));
    for(const i of [127,7,70,0,65,7])assert.equal(flickerVisible(random,seconds(i,15)),sequence[i]);
    assert(sequence.includes(true)&&sequence.includes(false));
    assert.notDeepEqual(sequence,sequence.map((_,i)=>flickerVisible({...random,seed:49822},seconds(i,15))));
    for(let i=0;i<128;i++)assert.equal(flickerVisible(random,seconds(i+.4,15)),sequence[i]);
  }finally{Math.random=saved;}
  const data={schemaVersion:1,assets:{},root:{id:"root",children:[{id:"camera",components:[{type:"Camera"}]},{id:"group",components:[{type:"Flicker",...periodic}],children:[{id:"light",components:[{type:"PlaneRenderer"}]}]}]}};
  const scene=new Scene(data,"http://localhost/");const at=time=>{scene.setFrameTime(Time.fromDecimal(time),frameRate(1));scene.updateWorld();return scene.animationSignature();};
  const first=at(0);assert.equal(scene.active.get("light"),true);assert.equal(at(1/120),first,"No redraw when the flicker-only scene stays in the same state");
  scene.setFrameTime(Time.fromFrame(Frame.from(1)),frameRate(30));scene.updateWorld();assert.notEqual(scene.animationSignature(),first);assert.equal(scene.active.get("light"),false);assert.equal(scene.find("group").active,true,"Flicker never edits authored activation");
  scene.setComponent("group","Flicker",{enabled:false});assert.equal(scene.active.get("light"),true);
  scene.find("group").active=false;at(0);assert.equal(scene.active.get("light"),false);
  for(const patch of [{frequency:0},{dutyCycle:2},{mode:"invalid"},{probability:-1},{seed:-1},{seed:1.5},{phase:-.1},{start:{frame:1.5,rate:frameRate(30)}}]){
    const bad=structuredClone(data);Object.assign(bad.root.children[1].components[0],patch);assert.throws(()=>new Scene(bad,"http://localhost/"));
  }
  console.log("Flicker: periodic boundaries, phase/duty, seeded random holds, arbitrary seek, inherited visibility, invalid settings and unchanged-state rendering passed.");
}
module.exports={check};
if(require.main===module)check().catch(error=>{console.error(error);process.exitCode=1;});
