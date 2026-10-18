import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {parse} from 'csv-parse/sync';
import {getDb} from '../lib/db.mjs';
import {hash} from '../lib/security.mjs';
import {octaneResponse,importRows} from '../lib/history.mjs';
const args=process.argv.slice(2),file=args[0];if(!file)throw Error('Usage: node tools/import-history.mjs FILE [--mapping mapping.json] [--apply]');
const raw=await fs.readFile(file),bytes=file.endsWith('.gz')?gunzipSync(raw):raw,text=bytes.toString('utf8').replace(/^\uFEFF/,'');
const fileHash=hash(raw);let rows;
if(file.replace(/\.gz$/,'').endsWith('.ndjson')){rows=text.trim().split('\n').map(line=>JSON.parse(line));if(rows.some(r=>!['klaviyo_octane','octane'].includes(r.source)||!r.id||!r.occurred_at))throw Error('Invalid normalized history');}
else{const mappingPath=args[args.indexOf('--mapping')+1];if(!args.includes('--mapping')||!mappingPath)throw Error('A reviewed field/result mapping is required for Octane exports');const mapping=JSON.parse(await fs.readFile(mappingPath,'utf8'));
 const data=file.replace(/\.gz$/,'').endsWith('.csv')?parse(text,{columns:true,skip_empty_lines:true,bom:true}):JSON.parse(text);
 const items=Array.isArray(data)?data:data.items;if(!Array.isArray(items))throw Error('Unrecognized export; no import performed');
 rows=items.map(row=>octaneResponse(row,mapping));
}
if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Duplicate identifiers within this import');
if(!args.includes('--apply')){console.log(JSON.stringify({mode:'dry-run',records:rows.length,completed:rows.filter(r=>r.completed_at||r.completion_observed).length,with_start:rows.filter(r=>r.started_at||r.start_observed).length,unmapped_results:rows.filter(r=>(r.completed_at||r.completion_observed)&&!r.result_key).length,question_keys:[...new Set(rows.flatMap(r=>Object.keys(r.answers||{})))],source:[...new Set(rows.map(r=>r.source))],sha256:fileHash,klaviyo_writes:0}));process.exit(0);}
const db=getDb(),result=await importRows(db,rows);
await db.query('INSERT INTO quiz_imports(file_hash,source,file_name,expected_count,accepted_count,rejected_count) VALUES($1,$2,$3,$4,$4,0) ON CONFLICT DO NOTHING',[fileHash,[...new Set(rows.map(r=>r.source))].join(','),path.basename(file),rows.length]);
console.log(JSON.stringify({...result,file_hash:fileHash,klaviyo_writes:0,note:'No fallback coverage has been replaced. Review counts before registering authoritative Octane coverage.'}));
