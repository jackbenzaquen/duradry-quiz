import {ATTRIBUTION_DAYS} from './conversion.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function orderFromEvent(event){
  const p=event.attributes?.event_properties||{},raw=p.$extra;
  if(!raw||raw.test||raw.cancelled_at||!['paid','partially_refunded','refunded'].includes(raw.financial_status))return null;
  const attributes=[...(raw.note_attributes||[]),...(raw.line_items||[]).flatMap(l=>l.properties||[])];
  const values=[...new Set(attributes.filter(a=>['dd_quiz_session','_dd_quiz_session','dd_quiz_session__'].includes(a.name||a.key)).map(a=>String(a.value||'').replace(/^native:/,'')))];
  if(values.length!==1||!UUID.test(values[0]))return null;
  const money=raw.total_price_set?.shop_money;
  const amount=String(money?.amount??raw.total_price??''),currency=money?.currency_code||raw.currency;
  const id=String(raw.admin_graphql_api_id||raw.id||'');
  if(!/^(gid:\/\/shopify\/Order\/)?\d+$/.test(id)||!/^\d+(\.\d{1,2})?$/.test(amount)||!Number.isFinite(Number(amount))||!/^[A-Z]{3}$/.test(currency||'')||!Number.isFinite(Date.parse(raw.created_at)))return null;
  return {id:id.startsWith('gid:')?id:'gid://shopify/Order/'+id,session_id:'native:'+values[0],paid_at:new Date(raw.created_at).toISOString(),amount,currency,attribution_method:'exact_session_attribute',ingest_source:'klaviyo_shopify',source_event_id:event.id};
}

export async function ingestOrderEvent(db,event){
  const order=orderFromEvent(event);if(!order)return 0;
  const [s]=await db.query('SELECT id,started_at,completed_at,is_test FROM quiz_sessions WHERE id=$1',[order.session_id]);
  if(!s||s.is_test||!s.started_at||!s.completed_at)return 0;
  const date=Date.parse(order.paid_at);
  if(date<Date.parse(s.completed_at)||date>Date.parse(s.started_at)+ATTRIBUTION_DAYS*86400000)return 0;
  await db.query(`INSERT INTO quiz_orders(id,session_id,paid_at,amount,currency,attribution_method,ingest_source,source_event_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET session_id=EXCLUDED.session_id,paid_at=EXCLUDED.paid_at,amount=EXCLUDED.amount,currency=EXCLUDED.currency,attribution_method=EXCLUDED.attribution_method,ingest_source=EXCLUDED.ingest_source,source_event_id=EXCLUDED.source_event_id,updated_at=now()`,Object.values(order));
  return 1;
}

export async function confirmQuizEvent(db,event){
  const p=event.attributes?.event_properties||{};
  if(p.source!=='native'||!UUID.test(p.session_id||''))return 0;
  const matched=await db.query(`UPDATE quiz_outbox o SET receipt_verified_at=now(),receipt_event_id=$2 FROM quiz_sessions s
    WHERE o.session_id=$1 AND s.id=o.session_id AND NOT s.is_test AND s.completed_at IS NOT NULL
    AND s.quiz_id=$3 AND s.version=$4 AND s.result_key=$5
    AND abs(extract(epoch FROM (s.completed_at-$6::timestamptz)))<2 RETURNING o.session_id`,['native:'+p.session_id,event.id,p.quiz_id,p.quiz_version,p.result_key,event.attributes.datetime]);
  return matched.length;
}
