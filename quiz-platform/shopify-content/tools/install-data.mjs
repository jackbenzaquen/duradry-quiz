import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const definitions=JSON.parse(await fs.readFile(path.join(root,'data/definitions.json'),'utf8'));
const entries=JSON.parse(await fs.readFile(path.join(root,'data/entries.json'),'utf8'));
const operations=(await fs.readFile(path.join(root,'tools/operations.graphql'),'utf8')).trim().split(/\n\n+/);
const apply=process.argv.includes('--apply');
if(!apply){
  console.log(JSON.stringify({mode:'dry-run',store:'duradry-store.myshopify.com',definitions:definitions.map(d=>d.type),entries:entries.length,existing_entries:'preserved',theme_changes:'none'},null,2));
  process.exit(0);
}
const store=process.env.SHOPIFY_STORE;
const token=process.env.SHOPIFY_ADMIN_TOKEN;
if(store!=='duradry-store.myshopify.com'||!token)throw new Error('Set SHOPIFY_STORE=duradry-store.myshopify.com and SHOPIFY_ADMIN_TOKEN securely in the process environment. Never place the token in theme files.');
const definitionIds=new Map();
const entryIds=new Map();
const manifest={store,created_at:new Date().toISOString(),definitions:[],entries:[]};
const checkpoint=async()=>fs.writeFile(path.join(root,'installation-manifest.json'),JSON.stringify(manifest,null,2));
async function graphql(query,variables){
  const response=await fetch(`https://${store}/admin/api/2026-07/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Shopify returned HTTP ${response.status}. Stop and inspect the installation manifest before retrying.`);
  const result=await response.json();
  if(result.errors?.length)throw new Error(JSON.stringify(result.errors));
  return result.data;
}
for(const source of definitions){
  const found=(await graphql(operations[0],{type:source.type})).metaobjectDefinitionByType;
  if(found){definitionIds.set(source.type,found.id);manifest.definitions.push({...found,status:'reused'});await checkpoint();continue;}
  const definition=structuredClone(source);
  for(const field of definition.fieldDefinitions){
    if(field.reference_type){
      const id=definitionIds.get(field.reference_type);if(!id)throw new Error('Missing definition dependency');
      field.validations=[...(field.validations||[]),{name:'metaobject_definition_id',value:id}];
      delete field.reference_type;
    }
  }
  const result=(await graphql(operations[1],{definition})).metaobjectDefinitionCreate;
  if(result.userErrors.length)throw new Error(JSON.stringify(result.userErrors));
  definitionIds.set(source.type,result.metaobjectDefinition.id);
  manifest.definitions.push({...result.metaobjectDefinition,status:'created'});await checkpoint();
}
function resolve(value){
  if(value&&typeof value==='object'&&!Array.isArray(value)&&value.$ref){
    const id=entryIds.get(value.$ref);if(!id)throw new Error('Missing entry dependency: '+value.$ref);return id;
  }
  if(Array.isArray(value))return value.map(resolve);
  return value;
}
for(const source of entries){
  const handle={type:source.type,handle:source.handle};
  const existing=(await graphql(operations[2],{handle})).metaobjectByHandle;
  if(existing){entryIds.set(source.type+'/'+source.handle,existing.id);manifest.entries.push({id:existing.id,...handle,status:'preserved'});await checkpoint();continue;}
  const fields=Object.entries(source.fields).map(([key,value])=>{const resolved=resolve(value);return {key,value:typeof resolved==='string'?resolved:JSON.stringify(resolved)};});
  const result=(await graphql(operations[3],{handle,metaobject:{fields}})).metaobjectUpsert;
  if(result.userErrors.length)throw new Error(JSON.stringify(result.userErrors));
  const id=result.metaobject.id;entryIds.set(source.type+'/'+source.handle,id);manifest.entries.push({id,...handle,status:'created'});await checkpoint();
}
const saved=(await graphql(operations[2],{handle:{type:'dd_quiz_flow',handle:'duradry-routine'}})).metaobjectByHandle;
if(!saved)throw new Error('Final flow readback failed');
console.log('Definitions and entries saved; flow readback verified. No theme or live page was changed.');
