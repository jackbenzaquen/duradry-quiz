import fs from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['tools/dashboard-entry.mjs'],bundle:true,platform:'browser',format:'iife',minify:true,outfile:'public/dashboard.js',target:['es2022']});
const config=JSON.parse(await fs.readFile('config/duradry-routine.json','utf8'));
if(config.questions.length!==8)throw Error('Unexpected seed configuration');
console.log('Dashboard bundle built. Runtime secrets are not required at build time.');
