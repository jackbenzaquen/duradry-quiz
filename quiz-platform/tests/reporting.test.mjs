import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {conversionFunnel,revenueSeries} from '../lib/conversion.mjs';
import {orderFromEvent,ingestOrderEvent,confirmQuizEvent} from '../lib/orders.mjs';
import {readEventWindow} from '../lib/klaviyo-read.mjs';
import {healthSnapshot,runHealthChecks} from '../lib/health.mjs';
import {recordCheck,state} from '../lib/monitor-store.mjs';
import {fetchReport} from '../lib/report.mjs';
import {range} from '../lib/dates.mjs';
const uuid='11111111-1111-4111-8111-111111111111',id='native:'+uuid;
const start='2026-10-19T12:00:00Z',completion='2026-10-19T12:01:00Z',now='2026-10-21T00:00:00Z';
const session={id,source:'native',started_at:start,completed_at:completion,occurred_at:start,events:[{kind:'question_viewed',question_key:'brand'},{kind:'question_viewed',question_key:'brand'},{kind:'question_skipped',question_key:'brand'}]};
const order={id:'o1',session_id:id,paid_at:'2026-10-20T14:00:00Z',amount:'40.12',currency:'USD',source:'native'};
const event={id:'event1',attributes:{datetime:'2026-10-20T14:00:15Z',event_properties:{$extra:{id:123,created_at:order.paid_at,financial_status:'paid',test:false,note_attributes:[{name:'dd_quiz_session',value:uuid}],total_price_set:{shop_money:{amount:'40.12',currency_code:'USD'}}}}}};
async function database(){const pg=new PGlite();await pg.exec(await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));const db={query:async(q,v=[])=> (await pg.query(q,v)).rows};await db.query("INSERT INTO quiz_sessions(id,source,source_id,quiz_id,version,occurred_at,started_at,completed_at,result_key) VALUES($1,'native',$2,'duradry-routine','v1',$3,$3,$4,'trio-red')",[id,uuid,start,completion]);return {pg,db};}

test('funnel uses native starts, optional skips continue, repeated orders count one converted session',()=>{
  const rows=[session,{...session,id:'abandoned',completed_at:null,events:[{kind:'question_viewed',question_key:'brand'}]},{...session,id:'legacy',source:'octane'},{...session,id:'no-start',started_at:null}];
  const f=conversionFunnel(rows,[order,order,{...order,id:'o2'}],{ordersAvailable:true,questions:[{key:'brand',title:'Brand',required:false}],now});
  assert.equal(f.starts,2);assert.equal(f.converted_sessions,1);assert.equal(f.start_to_order_rate,50);
  assert.equal(f.steps[1].reached,2);assert.equal(f.steps[1].drop_off_rate,50);
  assert.deepEqual(f.steps.slice(-2).map(s=>s.label),['Quiz submitted','Order placed']);
  assert.equal(f.completion_only_excluded,1);
  assert.equal(conversionFunnel(rows,[],{now}).start_to_order_rate,null);
  assert.equal(conversionFunnel(rows,[],{now,ordersAvailable:true}).start_to_order_rate,0);
  assert.equal(conversionFunnel([],[],{now,ordersAvailable:true}).start_to_order_rate,null);
});
test('future orders, orders before submission and outside 30 days cannot convert a cohort',()=>{
  for(const paid_at of ['2026-10-18T12:00:00Z','2026-10-22T12:00:00Z','2026-12-01T12:00:00Z'])assert.equal(conversionFunnel([session],[{...order,paid_at}],{now,ordersAvailable:true}).converted_sessions,0);
});
test('revenue uses order dates, fills real zero days, preserves currency and DST boundaries',()=>{
  const w=range({from:'2026-11-01',to:'2026-11-02'});
  const r=revenueSeries([{...order,paid_at:'2026-11-01T04:00:00Z'}, {...order,paid_at:'2026-11-01T04:00:00Z'}, {...order,id:'o2',amount:'12.05',currency:'CAD',paid_at:'2026-11-02T04:59:59Z'}, {...order,id:'outside',paid_at:'2026-11-03T05:00:00Z'}],w,{available:true});
  assert.equal(r.orders,2);assert.equal(r.daily[0].orders,2);assert.equal(r.daily[1].orders,0);assert.deepEqual(r.totals,{CAD:12.05,USD:40.12});
});
test('order parser requires an exact unique session marker, real paid order and shop currency',()=>{
  assert.equal(orderFromEvent(event).currency,'USD');
  for(const extra of [{test:true},{financial_status:'pending'},{cancelled_at:now},{note_attributes:[]},{note_attributes:[{name:'dd_quiz_session',value:uuid},{name:'dd_quiz_session',value:'22222222-2222-4222-8222-222222222222'}]},{total_price_set:{shop_money:{amount:'garbage',currency_code:'USD'}}}]){
    assert.equal(orderFromEvent({...event,attributes:{...event.attributes,event_properties:{$extra:{...event.attributes.event_properties.$extra,...extra}}}}),null);
  }
});
test('order import is idempotent, report dates separate cohort conversion from order revenue, receipt is proven',async()=>{
  const {pg,db}=await database();try{
    await ingestOrderEvent(db,event);await ingestOrderEvent(db,event);
    assert.equal((await db.query('SELECT * FROM quiz_orders')).length,1);
    await recordCheck(db,'orders','ok',{complete:true});
    const r=await fetchReport(db,{from:'2026-10-20',to:'2026-10-20',source:'native',compare:'false'});
    assert.equal(r.conversion_funnel.starts,0);assert.equal(r.revenue.orders,1);assert.equal(r.revenue.totals.USD,40.12);
    const r2=await fetchReport(db,{from:'2026-10-19',to:'2026-10-19',source:'native',compare:'false'});
    assert.equal(r2.conversion_funnel.converted_sessions,1);assert.equal(r2.revenue.orders,0);
    await db.query("INSERT INTO quiz_outbox(session_id,state) VALUES($1,'sent')",[id]);
    const receipt={id:'receipt1',attributes:{datetime:completion,event_properties:{source:'native',session_id:uuid,quiz_id:'duradry-routine',quiz_version:'v1',result_key:'trio-red'}}};
    assert.equal(await confirmQuizEvent(db,receipt),1);
    assert.equal(await confirmQuizEvent(db,{...receipt,attributes:{...receipt.attributes,event_properties:{...receipt.attributes.event_properties,result_key:'wrong'}}}),0);
    const [outbox]=await db.query('SELECT * FROM quiz_outbox');assert.equal(outbox.receipt_event_id,'receipt1');assert(outbox.receipt_verified_at);
    await db.query('UPDATE quiz_sessions SET is_test=true WHERE id=$1',[id]);assert.equal(await ingestOrderEvent(db,event),0);
  }finally{await pg.close();}
});
test('event paging resumes after page budget and failed pages do not advance checkpoint',async()=>{
  const {pg,db}=await database();try{
    const calls=[];const read=async path=>{calls.push(path);return {data:[{id:1}],links:{next:calls.length===1?'https://a.klaviyo.com/api/events/?page[cursor]=two':null}}};
    const first=await readEventWindow(db,'orders','metric',async()=>1,{read,maxPages:1,now});assert.equal(first.complete,false);assert((await state(db,'orders')).next);
    await assert.rejects(()=>readEventWindow(db,'orders','metric',async()=>{throw Error('database failed');},{read,now}));assert((await state(db,'orders')).next);
    const last=await readEventWindow(db,'orders','metric',async()=>1,{read,now});assert.equal(last.complete,true);assert.equal((await state(db,'orders')).to,now);
  }finally{await pg.close();}
});
test('health reports scope failures and missing heartbeat instead of green status',async()=>{
  const {pg,db}=await database();try{
    const env=Object.fromEntries(['DATABASE_URL','SHOPIFY_API_SECRET','SHOPIFY_STORE','KLAVIYO_PRIVATE_KEY','APP_SECRET','CONTACT_ENCRYPTION_KEY','CRON_SECRET'].map(k=>[k,'set']));
    const h=await healthSnapshot(db,{env});assert.equal(h.status,'error');assert.equal(h.checks.find(c=>c.key==='sync').status,'error');
    const failure=await runHealthChecks(db,{checkStorefront:false,read:async()=>{const e=Error();e.status=403;throw e;}});
    assert.equal(failure.checks.find(c=>c.key==='receipt_scan').status,'error');assert.match(failure.checks.find(c=>c.key==='receipt_scan').detail,/metrics:read/);
  }finally{await pg.close();}
});
