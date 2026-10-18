import {spawnSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';
const [directory,apply]=process.argv.slice(2);if(!directory)throw Error('Usage: HISTORY_DIRECTORY [--apply]');
const here=path.dirname(fileURLToPath(import.meta.url));
for(const [tool,file] of [['import-history.mjs','normalized-completions.ndjson'],['import-history.mjs','normalized-octane-responses.ndjson'],['import-history-links.mjs','session-links.json'],['import-reference-snapshot.mjs','octane-reference-snapshot.json']]){
 const result=spawnSync(process.execPath,[path.join(here,tool),path.resolve(directory,file),...(apply==='--apply'?['--apply']:[])],{stdio:'inherit',env:process.env});if(result.status!==0)process.exit(result.status||1);
}
