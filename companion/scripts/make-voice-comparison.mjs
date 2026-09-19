import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Agent} from 'undici';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=parseEnv(await readFile(resolve(root,'.env.voice.local'),'utf8'));
const destination=resolve(root,'../output/voice-auditions/comparison');
await mkdir(destination,{recursive:true});
const reference=resolve(root,config.REFERENCE_WAV),local=new Agent();
function normalize(bytes,name){return new Promise((done,reject)=>{
  const child=spawn(resolve(root,'../.tools/GPT-SoVITS/ffmpeg.exe'),['-y','-hide_banner','-loglevel','error','-i','pipe:0','-af','loudnorm=I=-20:TP=-2:LRA=7','-ac','1','-ar','24000',resolve(destination,name)],{windowsHide:true,stdio:['pipe','ignore','ignore']});
  const timer=setTimeout(()=>child.kill(),10000);child.stdin.on('error',()=>{});child.on('error',reject);child.on('close',code=>{clearTimeout(timer);code?reject(new Error('Comparison conversion failed')):done();});child.stdin.end(bytes);
});}
try {
  const response=await fetch('http://127.0.0.1:9880/tts',{method:'POST',dispatcher:local,headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),body:JSON.stringify({text:config.REFERENCE_TEXT,text_lang:'all_zh',ref_audio_path:reference,prompt_text:config.REFERENCE_TEXT,prompt_lang:'all_zh',text_split_method:'cut0',media_type:'wav',streaming_mode:false,batch_size:1,speed_factor:Number(config.TTS_SPEED||1),temperature:Number(config.TTS_TEMPERATURE||1),seed:42,top_k:15,top_p:1,parallel_infer:true})});
  if(!response.ok)throw new Error(`Comparison synthesis HTTP ${response.status}`);
  const audio=Buffer.from(await response.arrayBuffer());if(audio.length>6000000||audio.toString('ascii',0,4)!=='RIFF')throw new Error('Unexpected comparison audio');
  await normalize(await readFile(reference),'original.wav');await normalize(audio,'generated.wav');
  await writeFile(resolve(destination,'comparison.json'),JSON.stringify({generatedAt:new Date().toISOString(),text:config.REFERENCE_TEXT,reference:config.REFERENCE_WAV,temperature:Number(config.TTS_TEMPERATURE||1),speed:Number(config.TTS_SPEED||1),voiceSimilarityVerified:false,note:'Same-text listening comparison only. Repeating reference text does not establish generalization to new dialogue. Both files loudness-normalized to approximately -20 LUFS.'},null,2));
  console.log('Saved original.wav and generated.wav for same-text listening comparison.');
} finally {await local.close();}
