import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {range} from '../lib/dates.mjs';
import {hash,stable,verifyProxy,encrypt,decrypt} from '../lib/security.mjs';
import {registerConfig} from '../lib/config.mjs';
import {collect} from '../lib/collect.mjs';
import {aggregate,fetchReport} from '../lib/report.mjs';
import {legacyEvent,octaneResponse,importRows} from '../lib/history.mjs';
import {eventPayload,profilePayload,syncSession} from '../lib/klaviyo.mjs';
const config=JSON.parse(await fs.readFile(new URL('../config/duradry-routine.json',import.meta.url)));
process.env.APP_SECRET='a'.repeat(40);process.env.CONTACT_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
async function database(){const pg=new PGlite();await pg.exec(await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));return {pg,db:{query:async(sql,args=[])=> (await pg.query(sql,args)).rows,transaction:async queries=>pg.transaction(async tx=>{const all=[];for(const[sql,args]of queries)all.push((await tx.query(sql,args)).rows);return all;})}};}
test('timezone boundaries include DST transition days correctly',()=>{
 const spring=range({from:'2026-03-08',to:'2026-03-08'}),fall=range({from:'2026-11-01',to:'2026-11-01'});
 assert.equal((Date.parse(spring.end)-Date.parse(spring.start))/3600000,23);assert.equal((Date.parse(fall.end)-Date.parse(fall.start))/3600000,25);assert.throws(()=>range({from:'2026-02-30',to:'2026-03-01'}));
});
test('signed proxy rejects altered bodies, shops, and expired requests',()=>{
 const payload={kind:'completed',answers:{dry:['underarms']}},secret='test-secret',shop='duradry-store.myshopify.com',now=Date.now();
 const params=new URLSearchParams({shop,timestamp:String(Math.floor(now/1000)),body_hash:hash(stable(payload))});const text=[...params.keys()].sort().map(k=>k+'='+params.get(k)).join('');params.set('signature',createHmac('sha256',secret).update(text).digest('hex'));const url='/api/collect?'+params;
 assert(verifyProxy(url,payload,now,secret,shop));assert(!verifyProxy(url,{...payload,kind:'started'},now,secret,shop));assert(!verifyProxy(url,payload,now+600000,secret,shop));assert(!verifyProxy(url,payload,now,secret,'other.myshopify.com'));
});
test('contact encryption roundtrips and tampering is rejected',()=>{const value=encrypt({email:'test@example.invalid'});assert(!value.includes('@'));assert.equal(decrypt(value).email,'test@example.invalid');assert.throws(()=>decrypt(value.slice(0,-4)+'abcd'));});
test('legacy import preserves uncertain labels, unknown consent and deduplicates',async()=>{
 const {pg,db}=await database();try{const e={id:'old-1',attributes:{datetime:'2026-09-15T12:00:00Z',event_properties:{Octane_sweat_parts:'Underarms, Back',Octane_results_page:'https://duradry.com/pages/quiz-results-all-in-red'}},relationships:{profile:{data:{id:'p1'}}}};const row=legacyEvent(e);assert.deepEqual(row.answers.dry,['Underarms','Back (legacy label)']);assert.equal(row.email_consent,null);assert.equal(row.result_key,'signature-red');assert.equal((await importRows(db,[row])).inserted,1);assert.equal((await importRows(db,[row])).duplicates,1);assert.equal((await db.query('SELECT * FROM quiz_outbox')).length,0);await assert.rejects(()=>importRows(db,[{...row,raw_hash:'changed'}]));
 const report=await fetchReport(db,{from:'2026-09-01',to:'2026-09-30'});assert.equal(report.summary.completions,1);assert.equal(report.summary.observed_completion_rate,null);assert.equal(report.questions[0].options[0].share,100);
 }finally{await pg.close();}
});
test('native completion is durable, idempotent and queued once without PII in answers',async()=>{
 const {pg,db}=await database();try{await registerConfig(db,config);await assert.rejects(()=>registerConfig(db,{...config,title:'Changed title'}));const session_id=randomUUID();
 const begin={session_id,event_id:randomUUID(),kind:'started',analytics_allowed:true,answers:{}};await collect(db,begin,config,'2026-09-15T12:00:00Z');
 await collect(db,{session_id,event_id:randomUUID(),kind:'question_viewed',question_key:'gift',analytics_allowed:true,answers:{}},config,'2026-09-15T12:00:01Z');
 await collect(db,{session_id,event_id:randomUUID(),kind:'question_answered',question_key:'gift',elapsed_ms:1200,analytics_allowed:true,answers:{gift:['red']}},config,'2026-09-15T12:00:03Z');
 const payload={session_id,event_id:randomUUID(),kind:'completed',analytics_allowed:true,email_marketing_consent:false,answers:{gift:['red'],brand:'Example',dry:['underarms'],age:['35-40'],odor:['body'],gender:['not-shared'],email:'person@example.org','first-name':'Test'}};
 const saved=await collect(db,payload,config,'2026-09-15T12:02:00Z');assert.equal(saved.result_key,'trio-red');assert((await collect(db,payload,config)).duplicate);assert.equal((await db.query('SELECT * FROM quiz_outbox')).length,1);
 await assert.rejects(()=>collect(db,{...payload,event_id:randomUUID(),answers:{...payload.answers,gift:['cream']}},config));
 const [s]=await db.query('SELECT * FROM quiz_sessions');assert(!JSON.stringify(s.answers).includes('person@'));assert.equal(decrypt(s.contact_cipher).email,'person@example.org');
 await assert.rejects(()=>collect(db,{...payload,answers:{...payload.answers,dry:['invented']}},config));
 const report=await fetchReport(db,{from:'2026-09-15',to:'2026-09-15'});assert.equal(report.summary.completions,1);assert.equal(report.summary.observed_completion_rate,100);assert.equal(report.summary.median_completion_seconds,120);assert.equal(report.funnel[0].average_seconds,1.2);
 const requests=[];await syncSession(db,(await db.query('SELECT * FROM quiz_outbox'))[0],async(p,b)=>{requests.push([p,b]);return {data:{id:'p1'}};});assert.deepEqual(requests.map(r=>r[0]),['profile-import/','events/']);assert.equal(requests[1][1].data.attributes.metric.data.attributes.name,'Duradry Quiz Completed');assert.equal(requests[1][1].data.attributes.backfill,false);assert.equal((await db.query('SELECT state FROM quiz_outbox'))[0].state,'sent');
 }finally{await pg.close();}
});
test('unknown start history never invents a funnel or revenue and zero baseline is null',()=>{
 const r=aggregate([{id:'a',source:'klaviyo_octane',occurred_at:'2026-09-03T12:00:00Z',completed_at:'2026-09-03T12:00:00Z',answers:{dry:['Underarms','Back (legacy label)']}}],range({from:'2026-09-01',to:'2026-09-30'}));assert.equal(r.summary.observed_completion_rate,null);assert.equal(Object.keys(r.summary.linked_revenue).length,0);assert.equal(r.questions[0].options.reduce((n,o)=>n+o.share,0),200);assert.equal(r.funnel.length,0);
});

test('authoritative Octane coverage replaces fallback only in combined reports',async()=>{
 const {pg,db}=await database();try{
 const old=legacyEvent({id:'fallback',attributes:{datetime:'2026-09-12T12:05:00Z',event_properties:{}}});
 const direct=octaneResponse({session_id:'real-octane',status:'completed',started_at:'2026-09-12T12:00:00Z',completed_at:'2026-09-12T12:05:00Z',answers:{},result_page:'Trio'},{results:{Trio:'trio-red'}});
 await importRows(db,[old,direct]);await db.query("INSERT INTO quiz_imports(file_hash,source,file_name,expected_count,accepted_count,rejected_count) VALUES('test','octane','test.json',1,1,0)");
 await db.query("INSERT INTO quiz_source_coverage VALUES('duradry-routine','octane','2026-09-01','2026-10-01','test')");
 const filter={from:'2026-09-01',to:'2026-09-30'};assert.equal((await fetchReport(db,filter)).summary.completions,1);assert.equal((await fetchReport(db,{...filter,source:'klaviyo_octane'})).summary.completions,1);assert.equal((await db.query('SELECT * FROM quiz_sessions')).length,2);
 assert.throws(()=>octaneResponse({session_id:'missing-time',status:'completed',started_at:'2026-09-12T12:00:00Z'}));
 }finally{await pg.close();}
});
test('legacy CSV retains ambiguous rows, N/A consent and observed completion without invented times',async()=>{
 const {prepareLegacyCsv,csvFields,importLinks}=await import('../lib/legacy-csv.mjs');
 const base=Object.fromEntries(Object.values(csvFields).map(k=>[k,'']));Object.assign(base,{Timestamp:'2026-09-15 12:00:00','What is your email? - Marketing Consent':'N/A','Shareable quiz results URL':''});
 const filled={...base,[csvFields.welcome]:'Pressed continue button',[csvFields.dry]:'Underarms, Privates',[csvFields.email]:'person@example.org',[csvFields.result]:'Signature Cream','Shareable quiz results URL':'https://duradry.com/pages/oquiz#r=abcd'};
 const event={id:'e-csv',attributes:{datetime:'2026-09-15T12:01:00Z',event_properties:{'quiz results URL':filled['Shareable quiz results URL']}},relationships:{profile:{data:{id:'person'}}}};
 const bundle=prepareLegacyCsv([base,base,filled],[event],{timezone:'UTC'});assert.equal(bundle.rows.length,3);assert.notEqual(bundle.rows[0].id,bundle.rows[1].id);assert.equal(bundle.rows[2].email_consent,null);assert.equal(bundle.rows[2].started_at,null);assert.equal(bundle.rows[2].start_observed,true);assert(!JSON.stringify(bundle).includes('person@example.org'));
 const {pg,db}=await database();try{await importRows(db,[legacyEvent(event),...bundle.rows]);await importLinks(db,bundle.links);await importLinks(db,bundle.links);
 const r=await fetchReport(db,{from:'2026-09-15',to:'2026-09-15'});assert.equal(r.summary.sessions,3);assert.equal(r.summary.completions,1);assert.equal(r.summary.starts,1);assert.equal(r.summary.median_completion_seconds,null);assert.equal(r.response_coverage.rows,3);assert.equal((await fetchReport(db,{from:'2026-09-15',to:'2026-09-15',source:'klaviyo_octane'})).summary.completions,1);
 const unjoined=prepareLegacyCsv([filled],[],{timezone:'UTC'}).rows[0];assert.equal(unjoined.completed_at,null);assert.equal(aggregate([unjoined],range({from:'2026-09-15',to:'2026-09-15'})).summary.completions,1);
 }finally{await pg.close();}
});
