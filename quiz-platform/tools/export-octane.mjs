import fs from 'node:fs/promises';
import path from 'node:path';
const [dataset,from,to,outDir='octane-export']=process.argv.slice(2);
if(!['responses','profiles','quiz_analytics'].includes(dataset)||!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||''))throw Error('Usage: node tools/export-octane.mjs responses|profiles|quiz_analytics FROM TO OUTPUT_DIRECTORY');
if(!process.env.OCTANE_API_KEY||!process.env.OCTANE_QUIZ_ID)throw Error('Set OCTANE_API_KEY and the API quiz ID securely. The embed ID is not necessarily the API quiz ID.');
const base='https://api.octaneai.com/v1';
async function api(url,options={}){const u=new URL(url);if(u.origin!=='https://api.octaneai.com'||!u.pathname.startsWith('/v1/'))throw Error('Unexpected API URL');const r=await fetch(u,{...options,redirect:'error',headers:{Authorization:'Bearer '+process.env.OCTANE_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Octane HTTP '+r.status);return r.json();}
await fs.mkdir(outDir,{recursive:true});const checkpoint=path.join(outDir,dataset+'-job.json');
let job;try{job=JSON.parse(await fs.readFile(checkpoint,'utf8'));if(job.filters?.from!==from||job.filters?.to!==to)throw Error('Existing job has a different window. Use another directory.');}catch(error){if(error.code!=='ENOENT')throw error;job=await api(base+'/exports',{method:'POST',body:JSON.stringify({dataset,format:dataset==='profiles'?'csv':'json',quiz_id:process.env.OCTANE_QUIZ_ID,from,to,...(dataset==='quiz_analytics'?{tz:'America/New_York'}:{})})});}
await fs.writeFile(checkpoint,JSON.stringify({...job,download_url:undefined},null,2));
for(let n=0;n<12&&['pending','running'].includes(job.status);n++){await new Promise(resolve=>setTimeout(resolve,5000));job=await api(job.urls.self);}
if(job.status!=='completed'){console.log('Export is '+job.status+'. Rerun the same command to resume the existing job.');process.exit(0);}
if(!job.download_url)job=await api(job.urls.self);
const url=new URL(job.download_url);if(url.protocol!=='https:')throw Error('Invalid download URL');
const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Download failed'); // Signed URL: deliberately no API authorization header.
const name=dataset+'-'+from+'-'+to+(dataset==='profiles'?'.csv.gz':'.json.gz');
await fs.writeFile(path.join(outDir,name),Buffer.from(await response.arrayBuffer()));
await fs.writeFile(checkpoint,JSON.stringify({...job,download_url:undefined,download_url_expires_at:undefined},null,2));
console.log('Saved '+name+'; provider row count '+job.row_count+'. Preserve this original before importing.');
