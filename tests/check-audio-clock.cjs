const assert=require("node:assert/strict"),path=require("node:path"),{pathToFileURL}=require("node:url");

// A deterministic media source deliberately exposes time less often than RAF.
class Media extends EventTarget {
  static HAVE_FUTURE_DATA=3;
  dataset={};duration=120;readyState=4;paused=true;ended=false;seeking=false;
  mediaTime=0;quantum=0;playbackRate=1;volume=1;muted=false;loop=false;
  get currentTime(){return this.mediaTime;}
  set currentTime(time){
    this.mediaTime=this.quantum?Math.floor(time/this.quantum)*this.quantum:time;this.seeking=true;this.send("seeking");
    queueMicrotask(()=>{this.seeking=false;this.send("seeked");});
  }
  send(type){this.dispatchEvent(new Event(type));}
  load(){queueMicrotask(()=>this.send("loadedmetadata"));}
  async play(){this.paused=false;this.ended=false;this.send("play");this.send("playing");}
  pause(){this.paused=true;this.send("pause");}
  removeAttribute(){} remove(){}
}

async function main(){
  const {AudioPlayer,Frame,Time,frameRate}=await import(pathToFileURL(path.resolve(__dirname,"../dist/runtime/player.js")));
  const originals={Audio:global.Audio,HTMLMediaElement:global.HTMLMediaElement};
  global.Audio=global.HTMLMediaElement=Media;
  const rate=frameRate(24000),close=(a,b,message)=>assert(Math.abs(a-b)<1e-8,`${message}: ${a} vs ${b}`);
  let now=0;
  const player=new AudioPlayer("clock-test","test.mp3",{volume:1,muted:false,loop:false,preservesPitch:false,title:"",artist:"",album:""},{append(){}},()=>now);
  const audio=player.element,sample=()=>Time.toSeconds(player.sample(rate),rate);
  try{
    await player.ready;await player.play();
    now=250;close(sample(),0,"Playing without a moving media sample cannot advance through output startup latency");
    audio.mediaTime=.001;close(sample(),.001,"The first advancing media hint anchors audible playback");
    let previous=sample(),maxError=0;
    for(let frame=1;frame<=1800;frame++){
      now=250+frame*1000/60;audio.mediaTime=.001+Math.floor((frame/60+1e-9)*10)/10;
      if(frame%15===0)audio.send("timeupdate");
      const position=sample(),delta=position-previous;previous=position;
      assert(delta>0&&delta<=1.1/60+1e-8,"Coarse 10 Hz media hints must still produce smooth 60 Hz progression");
      maxError=Math.max(maxError,Math.abs(position-(now-250)/1000-.001));
    }
    assert(maxError<.05,`Normal quantized playback drift: ${maxError}`);
    const stale=sample();now+=250;close(sample()-stale,.25,"A repeated media hint must not freeze playback");
    audio.mediaTime=30.15;sample();const correcting=sample();now+=100;
    close(sample()-correcting,.09,"Moderate leading drift uses a bounded speed correction");
    audio.mediaTime=30.7;sample();const lagging=sample();now+=100;
    close(sample()-lagging,.11,"Moderate lag uses a bounded speed correction");
    audio.mediaTime=40;close(sample(),40,"Large drift resynchronizes to a fresh media hint");
    now+=16;const fresh=sample();close(Time.toSeconds(player.sample(rate,now-8),rate),fresh,"An older RAF timestamp cannot move the clock backward");

    audio.mediaTime=40.01;audio.pause();close(sample(),40.01,"Native pause immediately synchronizes");
    now+=5000;close(sample(),40.01,"Paused time remains fixed");
    await player.seekSeconds(12.345);close(sample(),12.345,"Explicit seek is exact while paused");
    audio.currentTime=9.125;await Promise.resolve();close(sample(),9.125,"A native seek is exact");
    await player.play();now+=200;close(sample(),9.125,"Play after a seek waits for actual media progress");
    audio.mediaTime=9.13;close(sample(),9.13,"Seek startup does not become animation lead");
    now+=20;close(sample(),9.15,"Interpolation resumes smoothly after the first fresh sample");
    await player.seekSeconds(11);now+=180;close(sample(),11,"A seek during playback also excludes decoder restart latency");
    audio.mediaTime=11.01;close(sample(),11.01,"The playing seek restarts from its first moving sample");
    audio.playbackRate=2;audio.send("ratechange");const doubled=sample();now+=100;
    close(sample()-doubled,.2,"Native rate changes alter wall-clock progression");
    player.setPlaybackRate(1,2);const halved=sample();now+=100;close(sample()-halved,.05,"Wrapper rate changes use the same transport");

    audio.readyState=2;audio.send("waiting");const stopped=sample();assert(player.buffering&&player.playing);
    now+=4000;close(sample(),stopped,"Buffering suspends interpolation");
    audio.readyState=4;audio.send("canplay");now+=100;close(sample(),stopped,"Readiness alone cannot advance a waiting clock");
    audio.send("playing");assert(!player.buffering);now+=100;close(sample(),stopped,"Playing can precede actual output after buffering");
    audio.mediaTime=stopped+.005;close(sample(),stopped+.005,"The first moving sample establishes the resumed anchor");
    now+=100;close(sample()-stopped,.055,"Actual playback resumes without counting buffered wall time");
    audio.send("stalled");const buffered=sample();now+=100;close(sample()-buffered,.05,"A stalled download does not stop buffered playback");
    audio.readyState=2;audio.send("stalled");assert(player.buffering);const empty=sample();now+=1000;close(sample(),empty,"An empty stalled buffer freezes time");
    audio.readyState=4;audio.send("playing");player.setPlaybackRate(1);

    audio.mediaTime=119.99;sample();audio.loop=true;audio.mediaTime=.01;now+=20;close(sample(),.01,"A native loop boundary resynchronizes immediately");
    now+=10000;audio.mediaTime=10.01;close(sample(),10.01,"A suspended tab resumes at the current media position");
    audio.mediaTime=120;audio.ended=true;audio.paused=true;audio.send("ended");now+=1000;close(sample(),120,"Ended media stays at the end");
    await player.play();await Promise.resolve();close(sample(),0,"Replay resets the anchor");
    await Promise.all([player.seekSeconds(1),player.seekSeconds(2)]);close(sample(),2,"The most recent overlapping seek wins");
    player.pause();
    for(const quantum of [0,.000001,.002]){
      audio.quantum=quantum;
      for(const sourceRate of [frameRate(30),frameRate(30000,1001)])for(const frame of [1,839,842,845,848,851,854]){
        const target=Time.fromFrame(Frame.from(frame));await player.seek(target,sourceRate);
        assert.equal(Time.key(player.sample(sourceRate)),`${frame}:0/1`,"An explicit frame seek survives floating-point seconds and media quantization");
        assert.equal(Time.compare(player.sample(rate),Time.convert(target,sourceRate,rate)),0,"Sampling another tick resolution preserves the exact rational seek");
        now+=1000;audio.send("timeupdate");audio.send("ratechange");audio.pause();
        assert.equal(Time.key(player.sample(sourceRate)),`${frame}:0/1`,"Paused samples and transport events cannot lose the requested frame");
      }
      const displayRate=frameRate(30),fraction=Time.fromRatio(1703n,2n);
      await player.seek(fraction,displayRate);assert.equal(Time.compare(player.sample(displayRate),fraction),0,"Subframe seeks are exact, never globally rounded");
      await player.play();now+=200;assert.equal(Time.compare(player.sample(displayRate),fraction),0,"Startup retains the exact seek while the media position is stationary");
      audio.mediaTime+=.01;close(sample(),audio.currentTime,"Actual media progress releases the seek anchor");
      now+=20;close(sample(),audio.currentTime+.02,"Smooth interpolation resumes after the first moving hint");
      player.pause();await player.seek(Time.fromFrame(Frame.from(851)),displayRate);
      audio.currentTime=850.75/30;await Promise.resolve();
      assert.equal(Time.compare(player.sample(rate),Time.fromSeconds(audio.currentTime,rate)),0,"A native seek overrides the exact application seek");
      await Promise.all([player.seek(Time.fromFrame(Frame.from(842)),displayRate),player.seek(Time.fromFrame(Frame.from(851)),displayRate)]);
      assert.equal(Time.key(player.sample(displayRate)),"851:0/1","Overlapping frame seeks retain only the newest rational anchor");
      await player.seek(Time.fromFrame(Frame.from(5000)),displayRate);close(sample(),audio.duration,"An exact seek still clamps to the media duration");
    }
    audio.quantum=0;await player.seekSeconds(2);
    player.dispose();now+=1000;close(sample(),2,"Disposal stops the interpolated clock");
    console.log(`Audio clock: exact frame/subframe seeks at rational rates with quantized media, native seek takeover, quantized hints (maximum drift ${(maxError*1000).toFixed(3)} ms), startup/seek output delay, stale samples, bounded correction, buffering, rate changes, loop, suspension and disposal passed.`);
  }finally{player.dispose();for(const [key,value] of Object.entries(originals)){if(value===undefined)delete global[key];else global[key]=value;}}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
