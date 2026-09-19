// Compare only operator-provided, fixed reference preprocessing. No user audio.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Agent} from 'undici';
const root=fileURLToPath(new URL('../../',import.meta.url));
const config=parseEnv(await readFile(resolve(root,'.env.voice.local'),'utf8'));
const source=resolve(root,config.REFERENCE_WAV), ffmpeg=resolve(root,'../.tools/GPT-SoVITS/ffmpeg.exe'), output=resolve(root,'../output/voice-auditions/reference-levels');
await mkdir(output,{recursive:true});
const levels=[['raw',null],['gain6','volume=6dB'],['gain12','volume=12dB'],['loudnorm','loudnorm=I=-20:TP=-2:LRA=11']];
const phrases=['你好呀，我是天天！我们一起去发现有趣的事情吧。','别着急，我们慢慢来。我陪你再试一次，好吗？','准备好了吗？让我们飞上天空，开始新的冒险吧！'];
function ffmpegRun(args, input=null) { return new Promise((done,reject)=>{const child=spawn(ffmpeg,args,{windowsHide:true,stdio:[input?'pipe':'ignore','pipe','pipe']});const out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.on('error',reject);child.on('close',code=>code?reject(new Error(Buffer.concat(err).toString()||'ffmpeg failed')):done(Buffer.concat(out)));if(input)child.stdin.end(input);}); }
try {
  const references={};
  for(const [name,filter] of levels){const file=resolve(output,`reference-${name}.wav`);if(name==='raw'){await writeFile(file,await readFile(source));}else{const bytes=await ffmpegRun(['-hide_banner','-loglevel','error','-i',source,'-af',filter,'-ac','1','-ar','32000','-f','wav','pipe:1']);await writeFile(file,bytes);}references[name]=file;}
  const local=new Agent();const samples=[];
  for(const [name] of levels) for(let i=0;i<phrases.length;i++){
    const text=phrases[i], response=await fetch('http://127.0.0.1:9880/tts',{method:'POST',dispatcher:local,signal:AbortSignal.timeout(120000),headers:{'Content-Type':'application/json'},body:JSON.stringify({text,text_lang:'all_zh',ref_audio_path:references[name],prompt_text:'太好了，我钩住了！',prompt_lang:'all_zh',text_split_method:'cut0',media_type:'wav',streaming_mode:false,batch_size:1,speed_factor:1,top_k:15,top_p:1,temperature:0.7,seed:42,parallel_infer:true})});
    if(!response.ok)throw new Error(`${name} HTTP ${response.status}`);const file=resolve(output,`${name}-${i+1}.wav`);await writeFile(file,Buffer.from(await response.arrayBuffer()));samples.push({reference:name,phrase:text,file,bytes:(await readFile(file)).length});console.log(name,i+1);
  }
  await local.close();await writeFile(resolve(output,'report.json'),JSON.stringify({generatedAt:new Date().toISOString(),source:config.REFERENCE_WAV,referenceText:'太好了，我钩住了！',method:'cut0,temperature 0.7,speed 1,seed 42',levels:levels.map(([name,filter])=>({name,filter})),samples,voiceSimilarityVerified:false},null,2));
} finally {}
