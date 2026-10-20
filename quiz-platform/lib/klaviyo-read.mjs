import {state,saveState} from './monitor-store.mjs';

export async function klaviyoRead(path){
  if(!process.env.KLAVIYO_PRIVATE_KEY)throw Error('Klaviyo key is not configured');
  const url=new URL(path,'https://a.klaviyo.com/api/');
  if(url.origin!=='https://a.klaviyo.com'||!url.pathname.startsWith('/api/'))throw Error('Invalid Klaviyo pagination URL');
  const response=await fetch(url,{headers:{Authorization:'Klaviyo-API-Key '+process.env.KLAVIYO_PRIVATE_KEY,revision:'2026-10-15',accept:'application/vnd.api+json'},signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!response.ok){const e=Error('Klaviyo read HTTP '+response.status);e.status=response.status;throw e;}
  return response.json();
}

export async function metricIds(db,read=klaviyoRead){
  const cached=await state(db,'metric_ids');
  if(cached.orders&&cached.completed&&Date.now()-Date.parse(cached.at)<86400000)return cached;
  let url='metrics/?fields[metric]=name,integration',pages=0;const matches={orders:[],completed:[]};
  do{
    const page=await read(url);
    for(const m of page.data||[]){const a=m.attributes||{};
      if(a.name==='Placed Order'&&a.integration?.key==='shopify')matches.orders.push(m.id);
      if(a.name==='Duradry Quiz Completed')matches.completed.push(m.id);
    }
    url=page.links?.next;if(++pages>10)throw Error('Metric pagination limit exceeded');
  }while(url);
  if(matches.orders.length!==1||matches.completed.length!==1)throw Error('Required Shopify order / native quiz metrics missing or ambiguous');
  const result={orders:matches.orders[0],completed:matches.completed[0],at:new Date().toISOString()};await saveState(db,'metric_ids',result);return result;
}

// Persist page cursors before continuing so runtime limits never silently omit a page.
export async function readEventWindow(db,key,metric,consume,{read=klaviyoRead,now=new Date().toISOString(),maxPages=3,deadline=Date.now()+35000}={}){
  const saved=await state(db,key);
  const [first]=await db.query("SELECT min(occurred_at) AS first FROM quiz_sessions WHERE source='native' AND NOT is_test");
  const initial=first?.first?new Date(first.first).toISOString():now;
  const from=saved.to?new Date(Math.max(Date.parse(initial),Date.parse(saved.to)-2*86400000)).toISOString():initial;
  const to=saved.next?saved.window_to:now;
  let next=saved.next||'events/?'+new URLSearchParams({filter:`and(equals(metric_id,"${metric}"),greater-or-equal(datetime,${from}),less-than(datetime,${to}))`,sort:'datetime','page[size]':'200','fields[event]':'datetime,event_properties'});
  let processed=0,pages=0,linked=0;
  do{
    if(Date.now()>deadline)break;
    const page=await read(next);if(!Array.isArray(page.data))throw Error('Invalid event response');
    for(const event of page.data){linked+=Number(await consume(event))||0;processed++;}
    next=page.links?.next||null;pages++;
    await saveState(db,key,{to:next?saved.to||null:to,next,window_to:to,last_checked_at:now,coverage_from:saved.coverage_from||initial});
  }while(next&&pages<maxPages);
  return {processed,linked,complete:!next,through:!next?to:saved.to||null};
}
