import {DateTime} from 'luxon';

export const ATTRIBUTION_DAYS=30;
const percent=(n,d)=>d?n/d*100:null;
const completed=s=>!!(s.completed_at||s.completion_observed);
const inRange=(date,window)=>Date.parse(date)>=Date.parse(window.start)&&Date.parse(date)<Date.parse(window.end);
const fallbackQuestions=[['gift','Gift choice'],['brand','Current brand (optional)'],['dry','Sweat areas'],['age','Age'],['odor','Odor areas'],['gender','Gender'],['email','Email'],['first-name','First name']];

// Count sessions, not events or orders. Repeated answers/back clicks never inflate reach.
export function conversionFunnel(rows,orders,{questions=[],now=new Date().toISOString(),ordersAvailable=false}={}){
  const cohort=rows.filter(s=>s.source==='native'&&s.started_at&&!s.is_test);
  const starts=cohort.length,submitted=cohort.filter(completed);
  const sessions=new Map(submitted.map(s=>[s.id,s]));
  const uniqueOrders=new Map(orders.map(o=>[o.id,o]));
  const converted=new Set([...uniqueOrders.values()].filter(o=>{
    const s=sessions.get(o.session_id),date=Date.parse(o.paid_at);
    return s&&!o.is_test&&o.eligible!==false&&date>=Date.parse(s.completed_at)&&date<=Date.parse(s.started_at)+ATTRIBUTION_DAYS*86400000&&date<=Date.parse(now);
  }).map(o=>o.session_id));
  const definitions=questions.length?questions:fallbackQuestions.map(([key,title])=>({key,title}));
  const keys=[...new Set([...definitions.map(q=>q.key),...cohort.flatMap(s=>(s.events||[]).filter(e=>e.kind==='question_viewed').map(e=>e.question_key).filter(Boolean))])];
  const steps=keys.map(key=>{
    const q=definitions.find(q=>q.key===key);
    const viewers=cohort.filter(s=>(s.events||[]).some(e=>e.kind==='question_viewed'&&e.question_key===key));
    const continued=viewers.filter(s=>completed(s)||(s.events||[]).some(e=>e.question_key===key&&['question_answered','question_skipped'].includes(e.kind))).length;
    return {key,label:q?.title||key,kind:'question',reached:viewers.length,continued,drop_off:viewers.length-continued,drop_off_rate:percent(viewers.length-continued,viewers.length),share_of_starts:percent(viewers.length,starts),optional:q?.required===false,conditional:!!q?.when?.length};
  });
  const beyondStart=cohort.filter(s=>completed(s)||(s.events||[]).some(e=>e.kind==='question_viewed')).length;
  return {basis:'Native sessions with an observed start in the selected dates; analytics consent required.',attribution_days:ATTRIBUTION_DAYS,starts,submitted:submitted.length,converted_sessions:ordersAvailable?converted.size:null,start_to_order_rate:ordersAvailable?percent(converted.size,starts):null,submission_to_order_rate:ordersAvailable?percent(converted.size,submitted.length):null,open_conversion_windows:cohort.filter(s=>Date.parse(s.started_at)+ATTRIBUTION_DAYS*86400000>Date.parse(now)).length,completion_only_excluded:rows.filter(s=>s.source==='native'&&completed(s)&&!s.started_at).length,steps:[
    {key:'started',label:'Quiz started',kind:'start',reached:starts,share_of_starts:percent(starts,starts),continued:beyondStart,drop_off:starts-beyondStart,drop_off_rate:percent(starts-beyondStart,starts)},
    ...steps,
    {key:'submitted',label:'Quiz submitted',kind:'submission',reached:submitted.length,share_of_starts:percent(submitted.length,starts),continued:ordersAvailable?converted.size:null,drop_off:ordersAvailable?submitted.length-converted.size:null,drop_off_rate:ordersAvailable?percent(submitted.length-converted.size,submitted.length):null},
    {key:'ordered',label:'Order placed',kind:'order',reached:ordersAvailable?converted.size:null,share_of_starts:ordersAvailable?percent(converted.size,starts):null,drop_off:null,drop_off_rate:null}
  ]};
}

export function revenueSeries(orders,window,{source='all',available=false}={}){
  const unique=new Map();
  for(const o of orders){if(o.is_test||o.eligible===false||(source!=='all'&&o.source&&o.source!==source)||!inRange(o.paid_at,window))continue;unique.set(o.id,o);}
  const currencies=[...new Set([...unique.values()].map(o=>o.currency))].sort();
  const days=[];
  for(let d=DateTime.fromISO(window.from,{zone:window.timezone});d<=DateTime.fromISO(window.to,{zone:window.timezone});d=d.plus({days:1}))days.push({date:d.toISODate(),orders:0,revenue:Object.fromEntries(currencies.map(c=>[c,0]))});
  const byDay=new Map(days.map(d=>[d.date,d]));
  for(const o of unique.values()){
    const d=byDay.get(DateTime.fromJSDate(new Date(o.paid_at)).setZone(window.timezone).toISODate());
    if(d){d.orders++;d.revenue[o.currency]+=Math.round(Number(o.amount)*100);}
  }
  const totals=Object.fromEntries(currencies.map(c=>[c,0]));
  for(const d of days)for(const c of currencies){d.revenue[c]/=100;totals[c]=Math.round((totals[c]+d.revenue[c])*100)/100;}
  return {available,currencies,daily:days,totals,orders:unique.size,basis:'Original paid order value after discounts, including shipping and tax, before refunds. Grouped by Shopify order creation date in the selected timezone, regardless of quiz start date.'};
}
