import fs from 'node:fs/promises';
import path from 'node:path';
import {legacyEvent} from '../lib/history.mjs';
import {hash} from '../lib/security.mjs';
const dir=process.argv[2];if(!dir)throw Error('Usage: node tools/prepare-klaviyo-history.mjs /path/to/quiz-history');
const files=(await fs.readdir(path.join(dir,'raw'))).filter(n=>/^page-\d+\.json$/.test(n)).sort();
const rows=[],seen=new Set(),manifest=[];let rejected=0;
for(const name of files){const raw=await fs.readFile(path.join(dir,'raw',name),'utf8'),data=JSON.parse(raw);manifest.push({file:name,sha256:hash(raw),records:data.data.length});
 for(const event of data.data){if(seen.has(event.id))throw Error('Duplicate raw event ID');seen.add(event.id);try{rows.push(legacyEvent(event));}catch{rejected++;}}
 if(name===files.at(-1)&&data.links?.next)throw Error('Final page has a next cursor: export is incomplete');
}
if(rejected)throw Error('Unmapped invalid records: '+rejected);
await fs.writeFile(path.join(dir,'normalized-completions.ndjson'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({source:'Klaviyo / Octane: quiz completed',metric_id:'YgExU7',cutoff_exclusive:'2026-10-18T04:00:00Z',timezone:'America/New_York',raw_records:seen.size,normalized_records:rows.length,duplicates:0,rejected:0,first:rows[0]?.occurred_at,last:rows.at(-1)?.occurred_at,files:manifest,limitations:['Completion-only records; not the full Octane session funnel.','Legacy body-area labels are retained with a legacy label suffix.','Marketing consent is unknown, not inferred from event presence.','Results are mapped from observed legacy page destinations; unknown outcomes remain null.']},null,2));
console.log(JSON.stringify({records:rows.length,first:rows[0]?.occurred_at,last:rows.at(-1)?.occurred_at}));
