// Fixed demonstration sentences only; results do not establish voice similarity.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { Agent, EnvHttpProxyAgent } from 'undici';
const root = fileURLToPath(new URL('../', import.meta.url));
const config = parseEnv(await readFile(resolve(root, '.env.voice.local'), 'utf8'));
const singleReference = process.argv.includes('--single-reference');
const hookReference = process.argv.includes('--hook-reference');
const multiReference = process.argv.includes('--multi-reference');
if (multiReference) {
  config.REFERENCE_WAV = '../.tools/voice-reference/clip-1440/candidates/skye-multi-clean.wav';
  config.REFERENCE_TEXT = '我来救！太好了，我钩住了！';
} else if (hookReference) {
  config.REFERENCE_WAV = '../.tools/voice-reference/clip-1440/candidates/skye-hook-padded.wav';
  config.REFERENCE_TEXT = '太好了，我钩住了！';
} else if (singleReference) {
  config.REFERENCE_WAV = '../.tools/voice-reference/clip-1440/skye-single-candidate.wav';
  config.REFERENCE_TEXT = '太好了，我钩住了！';
}
const local = new Agent(), cloud = new EnvHttpProxyAgent();
const destination = resolve(root, '../output/voice-auditions', multiReference ? 'calibration-multi-reference' : hookReference ? 'calibration-hook-reference' : singleReference ? 'calibration-single-reference' : 'calibration');
await mkdir(destination, { recursive: true });
const phrases = ['准备好了吗？让我们飞上天空，开始新的冒险吧！', '别着急，我们慢慢来。我陪你再试一次，好吗？', '你好呀，我是天天！我们一起去发现有趣的事情吧。'];
const variants = multiReference
  ? [{name:'multi-cut0',temperature:0.7,seed:42,split:'cut0',speed:1,parallel:true}, {name:'multi-calm',temperature:0.55,seed:42,split:'cut0',speed:0.95,parallel:false}, {name:'multi-cut5',temperature:0.7,seed:42,split:'cut5',speed:0.95,parallel:false}]
  : hookReference
  ? [{name:'cut0-natural',temperature:0.7,seed:42,split:'cut0',speed:1,parallel:true}, {name:'cut0-calm',temperature:0.55,seed:42,split:'cut0',speed:0.95,parallel:false}, {name:'cut5-current',temperature:0.7,seed:42,split:'cut5',speed:0.95,parallel:false}]
  : [{name:'baseline',temperature:0.7,seed:42}, {name:'lower-temperature',temperature:0.5,seed:42}, {name:'alternate-seed',temperature:0.7,seed:7}];
const report = {generatedAt:new Date().toISOString(), reference:config.REFERENCE_WAV, speed:multiReference || hookReference ? 'varied' : 0.95, voiceSimilarityVerified:false, humanListeningVerified:false, samples:[]};
const auth = await readFile(resolve(process.env.APPDATA, 'xdg.config/.wrangler/config/default.toml'), 'utf8');
const token = auth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error('Cloudflare login required for pronunciation checks.');
function normalize(wav, output) {
  return new Promise((resolveDone, reject) => {
    const child = spawn(resolve(root, '../.tools/GPT-SoVITS/ffmpeg.exe'), ['-y','-hide_banner','-loglevel','error','-i','pipe:0','-af','loudnorm=I=-20:TP=-2:LRA=7','-ac','1','-ar','24000',output], {windowsHide:true,stdio:['pipe','ignore','ignore']});
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdin.on('error', () => {}); child.on('error', reject);
    child.on('close', code => {clearTimeout(timer); code ? reject(new Error('Audio conversion failed')) : resolveDone();});
    child.stdin.end(wav);
  });
}
function distance(a,b) {
  a=[...a.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'')]; b=[...b.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'')];
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+Number(a[i]!==b[j])));row=next;}
  return {characterEdits:row[b.length],characters:a.length};
}
function pronunciationScore(text, transcript) {
  // Traditional output is a spelling variant, not a pronunciation error.
  const simplified = execFileSync(resolve(root, '../.tools/voice-venv/Scripts/python.exe'), ['-c', 'import sys; from opencc import OpenCC; sys.stdout.buffer.write(OpenCC("t2s").convert(sys.stdin.buffer.read().decode("utf-8")).encode("utf-8"))'], {input:transcript,encoding:'utf8',windowsHide:true,maxBuffer:64000}).trim();
  return {simplifiedTranscript:simplified,...distance(text,simplified)};
}
try {
  if (process.argv.includes('--rescore')) {
    const previous = JSON.parse(await readFile(resolve(destination,'report.json'),'utf8'));
    previous.samples = previous.samples.map(sample => ({...sample,...pronunciationScore(sample.text,sample.transcript)}));
    previous.scoring = 'OpenCC t2s, remove punctuation, character edit distance; ASR disagreement is not proof of synthesis error.';
    await writeFile(resolve(destination,'report.json'),JSON.stringify(previous,null,2));
    console.log(JSON.stringify(previous.samples.map(({name,characterEdits,synthesisMs})=>({name,characterEdits,synthesisMs}))));
  } else for (const variant of variants) for (let index=0; index<phrases.length; index++) {
    const text=phrases[index], started=performance.now();
    const response=await fetch('http://127.0.0.1:9880/tts',{method:'POST',dispatcher:local,signal:AbortSignal.timeout(120000),headers:{'Content-Type':'application/json'},body:JSON.stringify({text,text_lang:'all_zh',ref_audio_path:resolve(root,config.REFERENCE_WAV),prompt_text:config.REFERENCE_TEXT,prompt_lang:'all_zh',text_split_method:variant.split||'cut5',media_type:'wav',streaming_mode:false,batch_size:1,speed_factor:variant.speed||0.95,top_k:15,top_p:1,temperature:variant.temperature,seed:variant.seed,parallel_infer:variant.parallel ?? true})});
    if(!response.ok)throw new Error(`Local synthesis HTTP ${response.status}`);
    const wav=Buffer.from(await response.arrayBuffer()), synthesisMs=Math.round(performance.now()-started);
    if(wav.length>6000000||wav.toString('ascii',0,4)!=='RIFF')throw new Error('Unexpected audition audio');
    const file=`${variant.name}-${index+1}.wav`;await normalize(wav,resolve(destination,file));
    const audio=await readFile(resolve(destination,file));
    const recognition=await fetch('https://api.cloudflare.com/client/v4/accounts/748c38139c4cd7a116bbc759c73a0680/ai/run/@cf/openai/whisper-large-v3-turbo',{method:'POST',dispatcher:cloud,signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({audio:audio.toString('base64'),language:'zh',task:'transcribe',vad_filter:false,condition_on_previous_text:false})});
    if(!recognition.ok)throw new Error(`Pronunciation check HTTP ${recognition.status}`);
    const result=(await recognition.json()).result;
    const sample={...variant,file,text,transcript:result.text,synthesisMs,seconds:result.transcription_info?.duration,...pronunciationScore(text,result.text)};
    report.samples.push(sample);await writeFile(resolve(destination,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(sample));
  }
} finally { await local.close(); await cloud.close(); }
