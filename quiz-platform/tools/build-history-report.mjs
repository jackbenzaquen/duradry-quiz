import fs from 'node:fs/promises';
import path from 'node:path';
import {createHmac,randomBytes} from 'node:crypto';
const [historyDir,output]=process.argv.slice(2);if(!historyDir||!output)throw Error('Usage: HISTORY_DIRECTORY OUTPUT_HTML');
const readRows=async name=>(await fs.readFile(path.join(historyDir,name),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const raw=await readRows('normalized-completions.ndjson');let reference=null,links=[];try{raw.push(...await readRows('normalized-octane-responses.ndjson'));links=JSON.parse(await fs.readFile(path.join(historyDir,'session-links.json')));reference=JSON.parse(await fs.readFile(path.join(historyDir,'octane-reference-snapshot.json')));}catch(error){if(error.code!=='ENOENT')throw error;}
const duplicateIds=new Set(links.map(l=>l.duplicate_id)),salt=randomBytes(32);
const rows=raw.map((r,i)=>({id:String(i),source:r.source,occurred_at:r.occurred_at,completed_at:r.completed_at,started_at:r.started_at||null,start_observed:r.start_observed||false,completion_observed:r.completion_observed||false,response_flags:r.response_flags||{},duplicate_of:duplicateIds.has(r.id)?'exact-match':null,subject_key:r.subject_key?createHmac('sha256',salt).update(r.subject_key).digest('hex').slice(0,24):null,answers:Object.fromEntries(Object.entries(r.answers).map(([k,v])=>[k,k==='brand'&&/@|\d[\d\s()+.-]{7,}/.test(String(v))?'[redacted free text]':v])),result_key:r.result_key,email_consent:r.email_consent,is_test:r.is_test}));
const first=rows.map(r=>r.occurred_at).sort()[0],latest=rows.map(r=>r.occurred_at).sort().at(-1);
const css=await fs.readFile(new URL('../public/styles.css',import.meta.url),'utf8'),js=await fs.readFile(new URL('../public/dashboard.js',import.meta.url),'utf8');
let html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
const data=JSON.stringify({meta:{first,latest,raw_records:rows.length,exact_linked_events:links.length},rows,reference}).replaceAll('<','\\u003c');
html=html.replace(/<link rel="stylesheet" href="\/styles\.css(?:\?[^"]*)?">/,()=>'<style>'+css+'</style>').replace(/<script src="\/dashboard\.js(?:\?[^"]*)?"><\/script>/,()=>`<script>const saved=${data};window.DQ_META=saved.meta;window.DQ_DATA=saved.rows;window.DQ_REFERENCE=saved.reference;</script><script>${js.replaceAll('</script','<\\/script')}</script>`);
await fs.writeFile(output,html);console.log('Built private report with '+rows.length+' source records and '+links.length+' exact-match exclusions. No dedicated contact fields.');
