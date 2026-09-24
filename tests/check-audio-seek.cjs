const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {chromium,firefox}=require("playwright"),{makeServer}=require("./serve.cjs");

// Verify decoded sound, not just currentTime: a wrong compressed-audio seek can report
// the requested timestamp while playing an entirely different part of the song.
async function main(){
  const server=makeServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{for(const [label,type] of [["Firefox",firefox],["Chromium",chromium]]){
    const executablePath=type===chromium?[chromium.executablePath()].find(fs.existsSync):undefined;
    const browser=await type.launch({executablePath,headless:true});
    try{
      const page=await browser.newPage({viewport:{width:640,height:360}});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?renderer=dom&controls=0`);await page.waitForFunction(()=>window.scenePlayer?.ready);
      const results=await page.evaluate(async()=>{
        const engine=scenePlayer,audio=engine.audioPlayer.element,rate=24000;
        const offline=new OfflineAudioContext(1,1,rate),decoded=await offline.decodeAudioData(await(await fetch(audio.src)).arrayBuffer());
        const reference=new Float32Array(decoded.length);
        for(let channel=0;channel<decoded.numberOfChannels;channel++){const samples=decoded.getChannelData(channel);for(let i=0;i<samples.length;i++)reference[i]+=samples[i]/decoded.numberOfChannels;}
        const context=new AudioContext({sampleRate:rate}),source=context.createMediaElementSource(audio),capture=context.createScriptProcessor(1024,1,1);
        // This diagnostic tap is test-only. Production transport remains Audio.
        source.connect(capture);capture.connect(context.destination);await context.resume();
        let chunks=[];capture.onaudioprocess=event=>{chunks.push({samples:new Float32Array(event.inputBuffer.getChannelData(0)),media:audio.currentTime});event.outputBuffer.getChannelData(0).set(event.inputBuffer.getChannelData(0));};
        const results=[];
        try{for(const target of [16,24,4]){
          engine.pause();await engine.seek(target);chunks=[];await engine.play();await new Promise(resolve=>setTimeout(resolve,1400));engine.pause();
          const selected=chunks.slice(10,22),signal=new Float32Array(selected.length*1024);selected.forEach((c,i)=>signal.set(c.samples,i*1024));
          const stride=Math.max(1,Math.floor(signal.length/384)),offsets=[];let energy=0;
          for(let i=0;i<signal.length;i+=stride){offsets.push(i);energy+=signal[i]**2;}
          const score=position=>{let product=0,norm=0;for(const i of offsets){const value=reference[position+i];product+=signal[i]*value;norm+=value*value;}return product/Math.sqrt(Math.max(1e-20,energy*norm));};
          const center=selected[0].media,first=Math.max(0,Math.floor((center-2)*rate)),last=Math.min(reference.length-signal.length,Math.ceil((center+2)*rate));
          let best=-1,index=first;
          for(let i=first;i<=last;i+=2){const value=score(i);if(value>best){best=value;index=i;}}
          const coarse=index;for(let i=Math.max(first,coarse-2);i<=Math.min(last,coarse+2);i++){const value=score(i);if(value>best){best=value;index=i;}}
          results.push({target,correlation:best,mediaTime:center,decodedTime:index/rate,offsetMs:(center-index/rate)*1000});
        }}finally{engine.pause();capture.disconnect();source.disconnect();await context.close();}
        return results;
      });
      for(const r of results){assert(r.correlation>.45,`${label}: a recognizable waveform must follow seek ${r.target}: ${JSON.stringify(r)}`);assert(Math.abs(r.offsetMs)<150,`${label}: decoded sound must match the seek timeline, allowing the diagnostic audio buffer latency: ${JSON.stringify(r)}`);}
      console.log(`${label} audio seek: decoded waveforms match at 16, 24 and 4 seconds; offsets ${results.map(r=>r.offsetMs.toFixed(1)).join(", ")} ms (includes capture buffering).`);
    }finally{await browser.close();}
  }}finally{await new Promise(resolve=>server.close(resolve));}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
