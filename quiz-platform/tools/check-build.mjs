import fs from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['tools/dashboard-entry.mjs'],bundle:true,platform:'browser',format:'iife',minify:true,outfile:'public/dashboard.js',target:['es2022']});
const config=JSON.parse(await fs.readFile('config/duradry-routine.json','utf8'));
if(config.questions.length!==8)throw Error('Unexpected seed configuration');
console.log('Dashboard bundle built. Runtime secrets are not required at build time.');
// Additive, idempotent migrations run only on production, where runtime credentials exist.
if(process.env.VERCEL_ENV==='production'){
  await import('./migrate.mjs');
  const {getDb}=await import('../lib/db.mjs');
  const {runHealthChecks}=await import('../lib/health.mjs');
  const {fetchReport}=await import('../lib/report.mjs');
  const health=await runHealthChecks(getDb());
  const end=new Date().toISOString().slice(0,10);
  const report=await fetchReport(getDb(),{from:end,to:end,source:'native',compare:'false'});
  console.log('QUIZ_RELEASE_CHECK '+JSON.stringify({schema:report.schema_version,funnel_steps:report.conversion_funnel.steps.map(s=>s.label),health:health.checks.map(({key,status,detail})=>({key,status,detail}))}));
}
