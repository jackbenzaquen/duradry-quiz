import {getDb} from '../lib/db.mjs';
import {range} from '../lib/dates.mjs';
const [quiz,fileHash,from,to,confirm]=process.argv.slice(2);
if(confirm!=='--confirmed-complete')throw Error('Requires reviewed complete Octane response coverage. Usage: QUIZ FILE_SHA256 FROM TO --confirmed-complete');
const r=range({from,to,timezone:'UTC'}),db=getDb();
const imports=await db.query("SELECT * FROM quiz_imports WHERE file_hash=$1 AND source='octane' AND rejected_count=0",[fileHash]);if(!imports.length)throw Error('A successful Octane import is required');
await db.query("INSERT INTO quiz_source_coverage(quiz_id,source,from_at,to_at,file_hash) VALUES($1,'octane',$2,$3,$4) ON CONFLICT DO NOTHING",[quiz,r.start,r.end,fileHash]);
console.log('Combined reports now prefer Octane responses over Klaviyo fallback completions in this confirmed UTC window. Original records remain stored.');
