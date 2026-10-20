import {recordCheck} from './monitor-store.mjs';
import {metricIds,readEventWindow,klaviyoRead} from './klaviyo-read.mjs';
import {ingestOrderEvent,confirmQuizEvent} from './orders.mjs';

export async function healthSnapshot(db,{now=new Date().toISOString(),env=process.env}={}){
  const checks=[],add=(key,label,status,detail)=>checks.push({key,label,status,detail});
  const rows=await db.query('SELECT key,status,details,checked_at FROM quiz_checks');
  const stored=Object.fromEntries(rows.map(r=>[r.key,r]));
  const age=date=>date?(Date.parse(now)-Date.parse(date))/60000:Infinity;
  const [q]=await db.query(`SELECT count(*) FILTER(WHERE o.state='pending')::int AS pending,
    count(*) FILTER(WHERE o.state='failed')::int AS failed,
    count(*) FILTER(WHERE o.state='sent')::int AS accepted,
    count(*) FILTER(WHERE o.receipt_verified_at IS NOT NULL)::int AS confirmed,
    count(*) FILTER(WHERE o.state='sent' AND o.receipt_verified_at IS NULL AND o.updated_at<now()-interval '15 minutes')::int AS unconfirmed,
    min(s.completed_at) FILTER(WHERE o.state='pending') AS oldest_pending,
    max(o.receipt_verified_at) AS latest_receipt
    FROM quiz_outbox o JOIN quiz_sessions s ON s.id=o.session_id WHERE NOT s.is_test`);
  const [activity]=await db.query(`SELECT max(e.occurred_at) AS latest_event,
    max(s.completed_at) AS latest_completion FROM quiz_sessions s LEFT JOIN quiz_events e ON e.session_id=s.id WHERE s.source='native' AND NOT s.is_test`);
  const [missing]=await db.query(`SELECT count(*)::int AS n FROM quiz_sessions s LEFT JOIN quiz_outbox o ON o.session_id=s.id WHERE s.source='native' AND s.completed_at IS NOT NULL AND NOT s.is_test AND o.session_id IS NULL`);
  add('database','Database','ok','Connected; reporting tables readable.');
  const required=['DATABASE_URL','SHOPIFY_API_SECRET','SHOPIFY_STORE','KLAVIYO_PRIVATE_KEY','APP_SECRET','CONTACT_ENCRYPTION_KEY','CRON_SECRET'];
  const absent=required.filter(k=>!env[k]);
  if(env.KLAVIYO_SUBSCRIBE_OPT_INS==='true'&&!env.KLAVIYO_LIST_ID)absent.push('KLAVIYO_LIST_ID');
  add('configuration','Required configuration',absent.length?'error':'ok',absent.length?'Missing: '+absent.join(', '):'All required settings are present.');
  const worker=stored.sync;
  add('sync','Klaviyo sending worker',age(worker?.checked_at)>5?'error':worker.status,worker?`Last run ${new Date(worker.checked_at).toISOString()}; ${q.pending} queued, ${q.failed} failed.`:'No worker heartbeat has been recorded.');
  add('outbox','Delivery queue',q.failed||missing.n?'error':age(q.oldest_pending)>10&&q.pending?'warning':'ok',`${q.accepted} accepted by Klaviyo; ${q.pending} pending; ${q.failed} failed; ${missing.n} submissions missing a delivery job.`);
  add('receipt','Confirmed Klaviyo receipt',q.unconfirmed?'warning':q.confirmed?'ok':'unknown',`${q.confirmed} submission events read back from Klaviyo; ${q.unconfirmed} accepted events still unconfirmed after 15 minutes. This verifies event receipt, not email delivery.`);
  for(const [key,label] of [['receipt_scan','Klaviyo receipt checks'],['orders','Shopify order import'],['storefront','Live quiz page']]){
    const c=stored[key];const stale=age(c?.checked_at)>15;
    add(key,label,!c?'unknown':stale?'error':c.status,!c?'Not checked yet.':stale?'Check is stale. Last checked '+new Date(c.checked_at).toISOString():c.details.message||JSON.stringify(c.details));
  }
  add('collection','Quiz activity',age(activity.latest_event)>1440?'warning':activity.latest_event?'ok':'unknown',activity.latest_event?'Last real event '+new Date(activity.latest_event).toISOString()+(age(activity.latest_event)>1440?'. No activity for 24 hours; confirm traffic before treating this as an outage.':''):'No real quiz events recorded yet.');
  const status=checks.some(c=>c.status==='error')?'error':checks.some(c=>c.status==='warning'||c.status==='unknown')?'warning':'ok';
  return {status,checked_at:now,checks,queue:q,latest_activity:activity,orders_available:stored.orders?.status==='ok'&&!!stored.orders.details?.complete&&age(stored.orders.checked_at)<=15};
}

export async function runHealthChecks(db,{read=klaviyoRead,now=new Date().toISOString(),checkStorefront=true}={}){
  const deadline=Date.now()+42000;
  let metrics;
  try{metrics=await metricIds(db,read);}catch(e){
    const message=e.status===403?'Klaviyo key needs metrics:read and events:read scopes.':e.status?'Klaviyo API HTTP '+e.status:'Unable to discover required Klaviyo metrics.';
    await recordCheck(db,'receipt_scan','error',{message});await recordCheck(db,'orders','error',{message});
  }
  if(metrics)for(const [key,metric,consumer] of [['receipt_scan',metrics.completed,confirmQuizEvent],['orders',metrics.orders,ingestOrderEvent]]){
    try{
      const result=await readEventWindow(db,key,metric,e=>consumer(db,e),{read,now,deadline,maxPages:3});
      await recordCheck(db,key,result.complete?'ok':'warning',{...result,message:result.complete?`Read through ${result.through}. ${result.processed} events checked this pass; ${result.linked} matches.`:'Import catching up; saved cursor will resume on the next check.'});
    }catch(e){await recordCheck(db,key,'error',{message:e.status===403?'Klaviyo key needs events:read scope.':e.status?'Klaviyo read HTTP '+e.status:'Event read or database processing failed; next check will retry.'});}
  }
  if(checkStorefront&&Date.now()<deadline){
    try{
      const url=new URL(process.env.QUIZ_CONFIG_URL||'https://duradry.com/pages/oquiz');
      if(url.protocol!=='https:'||!['duradry.com','www.duradry.com',process.env.SHOPIFY_STORE].includes(url.hostname))throw Error('Invalid storefront host');
      const response=await fetch(url,{signal:AbortSignal.timeout(6000),redirect:'error'});const html=await response.text();
      if(!response.ok||!html.includes('data-dq-config')||!html.includes('app_proxy')||!html.includes('/apps/duradry-quiz'))throw Error('Missing quiz collector configuration');
      const matches=[...html.matchAll(/<script\b[^>]*\bdata-dq-config[^>]*>([\s\S]*?)<\/script>/g)];
      if(!matches.some(m=>JSON.parse(m[1])?.id==='duradry-routine'))throw Error('Quiz config missing');
      await recordCheck(db,'storefront','ok',{message:'Live page responds and includes native quiz configuration and the collector endpoint. This is a page check, not a synthetic submission.'});
    }catch{await recordCheck(db,'storefront','error',{message:'Live quiz page could not be read or its collector configuration is missing.'});}
  }
  const result=await healthSnapshot(db,{now});await recordCheck(db,'monitor',result.status,{checks:result.checks});return result;
}
