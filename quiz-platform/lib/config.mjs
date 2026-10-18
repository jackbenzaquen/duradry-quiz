import core from './quiz-core.cjs';
import {hash,stable} from './security.mjs';
export async function registerConfig(db,config){
  core.validate(config);const digest=hash(stable(config));
  const existing=await db.query('SELECT content_hash FROM quiz_configs WHERE quiz_id=$1 AND version=$2',[config.id,config.version]);
  if(existing.length&&existing[0].content_hash!==digest)throw Error('Quiz content changed without a new version. Increment the Shopify flow version.');
  await db.query('INSERT INTO quiz_configs(quiz_id,version,content,content_hash) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING',[config.id,config.version,JSON.stringify(config),digest]);return config;
}
export async function loadConfig(db,quiz,version){
  const saved=await db.query('SELECT content FROM quiz_configs WHERE quiz_id=$1 AND version=$2',[quiz,version]);
  if(saved.length)return saved[0].content;
  const url=new URL(process.env.QUIZ_CONFIG_URL||'https://duradry.com/pages/oquiz');
  if(url.protocol!=='https:'||!['duradry.com','www.duradry.com',process.env.SHOPIFY_STORE].includes(url.hostname))throw Error('Invalid quiz config host');
  const response=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw Error('Unable to read Shopify quiz configuration');
  const html=await response.text();if(html.length>4_000_000)throw Error('Quiz page is too large');
  const matches=[...html.matchAll(/<script\b[^>]*\bdata-dq-config[^>]*>([\s\S]*?)<\/script>/g)];
  const config=matches.map(m=>JSON.parse(m[1])).find(c=>c.id===quiz&&c.version===version);
  if(!config)throw Error('Quiz version has not been published or registered');return registerConfig(db,config);
}
export function validateAnswers(config,answers,complete=false){
  if(!answers||typeof answers!=='object'||Array.isArray(answers))throw Error('Invalid answers');
  const output=Object.create(null);for(const [key,value] of Object.entries(answers)){
    const q=config.questions.find(q=>q.key===key);if(!q)throw Error('Unknown question');
    if(['single','multiple'].includes(q.kind)){
      if(!Array.isArray(value)||value.length>q.options.length||new Set(value).size!==value.length||value.some(v=>!q.options.some(o=>o.value===v))||(q.kind==='single'&&value.length>1))throw Error('Invalid choice');output[key]=value;
    }else{if(typeof value!=='string'||value.length>(q.kind==='email'?254:200))throw Error('Invalid text');output[key]=value.trim();}
  }
  if(complete)for(const q of config.questions){if(!core.visible(q,output))continue;const value=output[q.key];if(q.required&&!core.list(value).length)throw Error('Missing required answer');if(q.kind==='email'&&value&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw Error('Invalid email');}
  return output;
}
export {core};
