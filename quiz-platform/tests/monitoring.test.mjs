import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {monitoringSnapshot} from '../lib/monitoring.mjs';

test('private monitoring aggregates real native activity and eligible orders without leaking records',async()=>{
  const pg=new PGlite();
  try{
    await pg.exec(await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
    const db={query:async(q,v=[])=> (await pg.query(q,v)).rows};
    for(const [id,source,isTest,started,completed] of [
      ['real','native',false,'2026-10-21T14:00Z','2026-10-21T14:05Z'],
      ['completion-only','native',false,null,'2026-10-21T15:00Z'],
      ['staff','native',true,'2026-10-21T14:00Z','2026-10-21T14:05Z'],
      ['old','octane',false,'2026-10-21T14:00Z','2026-10-21T14:05Z'],
      ['prior','native',false,'2026-10-19T14:00Z','2026-10-19T14:05Z']
    ]){
      await db.query(`INSERT INTO quiz_sessions(id,source,source_id,quiz_id,version,occurred_at,started_at,completed_at,is_test,answers,contact_cipher)
        VALUES($1,$2,$1,'duradry-routine','v1',coalesce($3::timestamptz,$4::timestamptz),$3,$4,$5,'{"private":"PERSONAL_DATA"}','SECRET_CONTACT')`,[id,source,started,completed,isTest]);
      await db.query("INSERT INTO quiz_events(id,session_id,kind,occurred_at,payload_hash) VALUES($1,$1,'question_viewed','2026-10-21T14:00Z','PRIVATE_HASH')",[id]);
    }
    for(const [id,sid,paid,method] of [['one','real','2026-10-21T16:00Z','exact_session_attribute'],['two','real','2026-10-21T17:00Z','exact_session_attribute'],['test','staff','2026-10-21T16:00Z','exact_session_attribute'],['legacy','old','2026-10-21T16:00Z','exact_session_attribute'],['early','real','2026-10-21T13:00Z','exact_session_attribute'],['manual','real','2026-10-21T16:00Z','legacy_link'],['no-start','completion-only','2026-10-21T16:00Z','exact_session_attribute']]){
      await db.query("INSERT INTO quiz_orders(id,session_id,paid_at,amount,currency,attribution_method) VALUES($1,$2,$3,'20.15','USD',$4)",[id,sid,paid,method]);
    }
    await db.query("INSERT INTO quiz_checks(key,status,details,checked_at) VALUES('orders','ok',$1,'2026-10-22T11:59Z')",[JSON.stringify({complete:true,through:'2026-10-22T11:58Z',processed:7,linked:2,message:'SECRET_ERROR',cursor:'SECRET_CURSOR'})]);
    const health={checked_at:'2026-10-22T12:00Z',status:'ok',checks:[{key:'orders',status:'ok',detail:'SECRET_ERROR'}],orders_available:true,queue:{pending:0,failed:0,accepted:2,confirmed:2,unconfirmed:0},latest_activity:{latest_event:'2026-10-21T14:00Z'}};
    const result=await monitoringSnapshot(db,health);
    assert.equal(result.sessions.total,3);
    assert.equal(result.sessions.starts_24h,1);
    assert.equal(result.sessions.completions_24h,2);
    assert.equal(result.sessions.completions_prior_7d,1);
    assert.equal(result.sessions.completed_without_start,1);
    assert.equal(result.sessions.missing_delivery_jobs,3);
    assert.equal(result.events.events_24h,3);
    assert.equal(result.events.active_sessions_24h,3);
    assert.deepEqual(result.orders_by_currency,[{currency:'USD',orders_24h:2,converting_sessions_24h:1,revenue_24h:'40.30',latest_order:'2026-10-21T17:00:00.000Z'}]);
    assert.equal(result.imports.find(r=>r.key==='orders').complete,true);
    assert.equal(result.imports.find(r=>r.key==='receipt_scan').processed,null);
    assert.equal(result.checks.find(r=>r.key==='orders').last_checked_at,'2026-10-22T11:59:00.000Z');
    assert.equal(result.checks.find(r=>r.key==='sync').status,'unknown');
    const encoded=JSON.stringify(result);
    assert(!/PERSONAL_DATA|SECRET_|PRIVATE_HASH|session_id|contact_cipher|cursor|answers/.test(encoded));
    assert(encoded.length<4000);
    await assert.rejects(()=>monitoringSnapshot(db,{...health,checked_at:'invalid'}));
    await assert.rejects(()=>monitoringSnapshot({query:async()=>{throw Error('DB unavailable');}},health));
  }finally{await pg.close();}
});
