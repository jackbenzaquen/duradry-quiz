import {DateTime} from 'luxon';
import {range} from './dates.mjs';
import {reportFunnels,revenueSeries} from './conversion.mjs';
const labels={gift:'Gift preference',brand:'Current deodorant brand',dry:'Sweat areas',age:'Age',odor:'Odor areas',gender:'Gender'};
const cleanText=value=>{const s=String(value).trim().slice(0,120);return /@|\d[\d\s()+.-]{7,}/.test(s)?'[redacted free text]':s;};
const values=value=>Array.isArray(value)?value:value===null||value===undefined||value===''?[]:[value];
const percentage=(n,d)=>d?n/d*100:null;
const hasStart=s=>!!(s.started_at||s.start_observed);
const hasCompletion=s=>!!(s.completed_at||s.completion_observed);
const stepLabels={welcome:'Welcome interaction',gift:'Gift choice',brand:'Brand entered (optional)',dry:'Sweat areas',age:'Age',odor:'Odor areas',gender:'Gender',email:'Email entered',first_name:'First name entered',calculation:'Calculation continued',result:'Result captured'};
// These dates describe observed records, not continuous tracking coverage.
export function availabilityFromBounds(bounds,timezone){
  const date=value=>value?DateTime.fromJSDate(new Date(value),{zone:timezone}).toISODate():null;
  const sources=bounds.map(b=>({source:b.source,first_record_date:date(b.first_record_at),last_record_date:date(b.last_record_at)}));
  return {first_record_date:sources.map(s=>s.first_record_date).filter(Boolean).sort()[0]||null,last_record_date:sources.map(s=>s.last_record_date).filter(Boolean).sort().at(-1)||null,sources};
}
export function historyAvailability(sessions,{source='all',timezone='America/New_York'}={}){
  const bounds=new Map();
  for(const s of sessions){if(s.is_test||(source==='all'&&s.duplicate_of)||(source!=='all'&&s.source!==source))continue;const time=new Date(s.occurred_at).toISOString();const b=bounds.get(s.source)||{source:s.source,first_record_at:time,last_record_at:time};if(time<b.first_record_at)b.first_record_at=time;if(time>b.last_record_at)b.last_record_at=time;bounds.set(s.source,b);}
  return availabilityFromBounds([...bounds.values()],timezone);
}
export function allHistoryWindow(input,availability){
  const timezone=input.timezone||'America/New_York';
  const to=DateTime.now().setZone(timezone).minus({days:1}).toISODate();
  return range({...input,from:availability.first_record_date&&availability.first_record_date<to?availability.first_record_date:to,to});
}
export function compareReports(current,previous,availability){
  current.previous=previous;
  let reason=null,message=null;
  if(!previous.summary.sessions){reason='no_prior_records';message='No recorded data in the previous period; no percentage change is shown.';}
  else if(availability?.first_record_date&&availability.first_record_date>previous.window.from){reason='partial_prior_history';message='The previous period begins before available history; no percentage change is shown.';}
  else if(Object.keys(current.sources).sort().join(',')!==Object.keys(previous.sources).sort().join(',')){reason='different_sources';message='The periods contain different data sources; no percentage change is shown.';}
  else if(availability?.sources?.some(s=>(current.sources[s.source]||previous.sources[s.source])&&s.first_record_date>previous.window.from)){reason='partial_source_history';message='At least one source starts partway through these periods; no percentage change is shown.';}
  current.comparison={status:reason?'unavailable':'available',reason,message};
  current.changes={completions_pct:!reason&&previous.summary.completions?(current.summary.completions/previous.summary.completions-1)*100:null,completion_rate_pp:reason||current.summary.observed_completion_rate===null||previous.summary.observed_completion_rate===null?null:current.summary.observed_completion_rate-previous.summary.observed_completion_rate};
  return current;
}
export function aggregate(sessions,window,{source='all',answerPopulation='completed',orders=[],questions:questionDefinitions=[],ordersAvailable=false,now=new Date().toISOString()}={}){
  const rows=sessions.filter(s=>!s.is_test&&(source!=='all'||!s.duplicate_of)&&new Date(s.occurred_at)>=new Date(window.start)&&new Date(s.occurred_at)<new Date(window.end)&&(source==='all'||s.source===source));
  const completed=rows.filter(hasCompletion),started=rows.filter(hasStart),trackedCompleted=started.filter(hasCompletion);
  const views=rows.filter(s=>(s.events||[]).some(e=>e.kind==='viewed')).length;
  const sourceDetails=new Map();
  const days=Object.create(null),results=Object.create(null),sources=Object.create(null),questions=Object.create(null),funnel=Object.create(null);
  for(let d=DateTime.fromISO(window.from,{zone:window.timezone});d<=DateTime.fromISO(window.to,{zone:window.timezone});d=d.plus({days:1}))days[d.toISODate()]={date:d.toISODate(),completions:0,starts:0,observed_completions:0};
  const coverage={completion_only:0,with_start:started.length,with_consent:0,missing_result:0,unknown_result:0};
  const duration=[];
  for(const s of rows){
    const day=DateTime.fromISO(new Date(s.occurred_at).toISOString()).setZone(window.timezone).toISODate();
    sources[s.source]=(sources[s.source]||0)+1;
    const detail=sourceDetails.get(s.source)||{source:s.source,records:0,completions:0,starts:0,observed_completions:0,completion_only:0,first_record_date:day,last_record_date:day,first_start_date:null,last_start_date:null};
    detail.records++;detail.first_record_date=day<detail.first_record_date?day:detail.first_record_date;detail.last_record_date=day>detail.last_record_date?day:detail.last_record_date;
    if(hasStart(s)){detail.starts++;detail.first_start_date=!detail.first_start_date||day<detail.first_start_date?day:detail.first_start_date;detail.last_start_date=!detail.last_start_date||day>detail.last_start_date?day:detail.last_start_date;}
    if(hasCompletion(s)){detail.completions++;if(hasStart(s))detail.observed_completions++;else detail.completion_only++;}
    sourceDetails.set(s.source,detail);
    if(hasStart(s)&&days[day])days[day].starts++;
    if(hasCompletion(s)){
      if(days[day]){days[day].completions++;if(hasStart(s))days[day].observed_completions++;}
      results[s.result_key||'Unmapped legacy result']=(results[s.result_key||'Unmapped legacy result']||0)+1;
      if(!hasStart(s))coverage.completion_only++;
      if(!s.result_key)coverage.missing_result++;
      if(s.result_key==='legacy_unmapped')coverage.unknown_result++;
      if(s.email_consent!==null&&s.email_consent!==undefined)coverage.with_consent++;
      if(s.started_at&&s.completed_at){const seconds=(new Date(s.completed_at)-new Date(s.started_at))/1000;if(seconds>=0&&seconds<86400)duration.push(seconds);}
    }
    for(const [key,raw] of Object.entries(answerPopulation==='completed'&&!hasCompletion(s)?{}:s.answers||{})){
      if(/email|name|phone/i.test(key))continue;
      const answerValues=[...new Set(values(raw).map(cleanText).filter(Boolean))];if(!answerValues.length)continue;
      questions[key]||={key,label:labels[key]||key,respondents:0,completed_respondents:0,options:Object.create(null)};
      const q=questions[key];q.respondents++;if(hasCompletion(s))q.completed_respondents++;
      for(const value of answerValues){q.options[value]||={label:value,count:0,completed:0};q.options[value].count++;if(hasCompletion(s))q.options[value].completed++;}
    }
    const viewed=new Set((s.events||[]).filter(e=>e.kind==='question_viewed').map(e=>e.question_key));
    for(const key of viewed){if(!key)continue;funnel[key]||={key,viewed:0,answered:0,skipped:0,back_clicks:0,timed_responses:0,total_ms:0};funnel[key].viewed++;funnel[key].back_clicks+=(s.events||[]).filter(e=>e.question_key===key&&e.kind==='question_back').length;for(const e of s.events||[]){if(e.question_key===key&&['question_answered','question_skipped'].includes(e.kind)&&Number.isInteger(e.elapsed_ms)){funnel[key].timed_responses++;funnel[key].total_ms+=e.elapsed_ms;}}if((s.events||[]).some(e=>e.question_key===key&&e.kind==='question_answered'))funnel[key].answered++;else if((s.events||[]).some(e=>e.question_key===key&&e.kind==='question_skipped'))funnel[key].skipped++;}
  }
  const responseRows=rows.filter(s=>Object.keys(s.response_flags||{}).length);
  const responseCoverage={rows:responseRows.length,steps:Object.entries(stepLabels).map(([key,label])=>({key,label,count:responseRows.filter(s=>s.response_flags[key]).length,share:percentage(responseRows.filter(s=>s.response_flags[key]).length,responseRows.length)}))};
  const reportQuestions=Object.values(questions).map(q=>({...q,options:Object.values(q.options).map(o=>({...o,share:percentage(o.count,q.respondents)})).sort((a,b)=>b.count-a.count),denominator:'Respondents who answered this question; multi-select percentages may exceed 100%.'}));
  const rowIds=new Set(rows.map(s=>s.id));const associated=orders.filter(o=>rowIds.has(o.session_id));const revenueByCurrency=Object.create(null);for(const order of associated){revenueByCurrency[order.currency]=(revenueByCurrency[order.currency]||0)+Number(order.amount);}
  duration.sort((a,b)=>a-b);const median=duration.length?(duration[Math.floor((duration.length-1)/2)]+duration[Math.ceil((duration.length-1)/2)])/2:null;
  const identified=completed.filter(s=>s.subject_key);const people=new Set(identified.map(s=>s.subject_key)).size;
  const reconciliation={completed_with_start:trackedCompleted.length,started_without_completion:started.length-trackedCompleted.length,completed_without_start:completed.length-trackedCompleted.length,neither_start_nor_completion:rows.length-started.length-completed.length+trackedCompleted.length,without_completion:rows.length-completed.length,identified_completions:identified.length,unidentified_completions:completed.length-identified.length,identified_completers:people};
  const sourceCoverage=[...sourceDetails.values()].sort((a,b)=>a.source.localeCompare(b.source));
  return {schema_version:4,reconciliation,source_coverage:sourceCoverage,...reportFunnels(rows,orders,{source,questions:questionDefinitions,now,ordersAvailable}),generated_at:now,window,source,answer_population:answerPopulation,summary:{sessions:rows.length,views:views||null,starts:started.length||null,completions:completed.length,observed_completions:trackedCompleted.length,observed_completion_rate:percentage(trackedCompleted.length,started.length),identified_people:people||null,repeat_identified_completions:identified.length-people,consented_completions:completed.filter(s=>s.email_consent===true).length,consent_rate:percentage(completed.filter(s=>s.email_consent===true).length,coverage.with_consent),median_completion_seconds:median,linked_orders:associated.length||null,linked_revenue:revenueByCurrency},daily:Object.values(days),results:Object.entries(results).map(([label,count])=>({label,count,share:percentage(count,completed.length)})).sort((a,b)=>b.count-a.count),questions:reportQuestions,response_coverage:responseCoverage,funnel:Object.values(funnel).map(f=>({...f,average_seconds:f.timed_responses?f.total_ms/f.timed_responses/1000:null,not_continued:f.viewed-f.answered-f.skipped,not_continued_rate:percentage(f.viewed-f.answered-f.skipped,f.viewed)})),sources,coverage,notes:[
    'Dates use recorded session time for Octane CSV, first event for native sessions, and completion time for Klaviyo-only history. End date includes the full local day.',
    'Observed completion rate uses native starts or CSV welcome interactions. It is a session-based measure, not Octane unique-person conversion; Klaviyo-only history is excluded.',
    'Legacy answer labels remain separate when their mapping to current wording is unverified.',
    'Identified people use available stable identifiers, not a guaranteed cross-device identity count.',
    'Attribution uses an exact dd_quiz_session order/cart or line-item attribute and a 30-day window from the observed native start. Each order is counted once and each converted session is counted once. No email-based or product-based attribution is inferred.',
    'Funnel views separate Octane CSV recorded responses from native question views. Octane submissions use result-page or matched completion evidence; recommendation products are not orders. Historical order attribution is unavailable in the CSV, not zero. Recent native cohorts have open conversion windows.',
    'Question drop-off = viewed sessions with neither an answer/skip nor a submission, divided by question viewers. Optional skips count as continuation. Conditional steps can have fewer views without representing abandonment. Submission drop-off means no linked order yet.',
    'Revenue is original paid order value after discounts, including shipping and tax, before refunds; it is attributed, not incremental revenue. Revenue dates are order creation dates, while funnel dates select quiz start cohorts.',
    'CSV timestamp timezone is inferred as UTC from 4,426 exact result-link matches. Exact start and completion times are not fabricated.',
    'Response coverage counts recorded answers, not question views or proven abandonment. Blank optional answers do not mean drop-off.',
    'Combined history suppresses exact linked Klaviyo duplicates; originals remain available under their own source.',
    'Consent percentage uses only completions with known consent status; unknown legacy consent is excluded.'
  ]};
}
export async function fetchReport(db,input={}){
  let window=range(input);const source=input.source||'all';if(!['all','native','octane','klaviyo_octane'].includes(source))throw Error('Invalid source');
  const answerPopulation=input.answers||'completed';if(!['all','completed'].includes(answerPopulation))throw Error('Invalid answer population');
  const quiz=input.quiz||'duradry-routine',result=input.result||'';
  const bounds=await db.query(`SELECT s.source,min(s.occurred_at) AS first_record_at,max(s.occurred_at) AS last_record_at
    FROM quiz_sessions s WHERE s.quiz_id=$1 AND NOT s.is_test AND ($2='all' OR s.source=$2) AND ($3='' OR s.result_key=$3)
    AND ($2<>'all' OR NOT EXISTS(SELECT 1 FROM quiz_session_links l WHERE l.duplicate_id=s.id))
    AND (s.source<>'klaviyo_octane' OR $2<>'all' OR NOT EXISTS(SELECT 1 FROM quiz_source_coverage c WHERE c.quiz_id=s.quiz_id AND c.source='octane' AND s.occurred_at>=c.from_at AND s.occurred_at<c.to_at))
    GROUP BY s.source`,[quiz,source,result]);
  const availability=availabilityFromBounds(bounds,window.timezone);
  if(input.period==='all')window=allHistoryWindow(input,availability);
  const compareRequested=input.compare!=='false'&&input.period!=='all';
  const fromPrevious=compareRequested?range({...window,...window.previous}).start:window.start;
  const rows=await db.query(`SELECT s.id,s.source,s.quiz_id,s.version,s.occurred_at,s.started_at,s.completed_at,s.subject_key,s.answers,s.result_key,s.email_consent,s.is_test,s.start_observed,s.completion_observed,s.response_flags,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',e.kind,'question_key',e.question_key,'elapsed_ms',e.elapsed_ms)) FROM quiz_events e WHERE e.session_id=s.id),'[]') AS events
    FROM quiz_sessions s WHERE s.occurred_at >= $1 AND s.occurred_at < $2 AND s.quiz_id=$3 AND NOT s.is_test
    AND ($4<>'all' OR NOT EXISTS(SELECT 1 FROM quiz_session_links l WHERE l.duplicate_id=s.id))
    AND ($4='all' OR s.source=$4) AND ($5='' OR s.result_key=$5)
    AND (s.source<>'klaviyo_octane' OR $4<>'all' OR NOT EXISTS(SELECT 1 FROM quiz_source_coverage c WHERE c.quiz_id=s.quiz_id AND c.source='octane' AND s.occurred_at>=c.from_at AND s.occurred_at<c.to_at))
    ORDER BY s.occurred_at LIMIT 100001`,[fromPrevious,window.end,quiz,source,result]);
  if(rows.length>100000)throw Error('More than 100,000 sessions matched; narrow the date range. No partial report was returned.');
  const orderRows=await db.query(`SELECT o.id,o.session_id,o.paid_at,o.amount,o.currency,s.source FROM quiz_orders o JOIN quiz_sessions s ON s.id=o.session_id
    WHERE s.quiz_id=$3 AND NOT s.is_test AND (($4='all' AND NOT EXISTS(SELECT 1 FROM quiz_session_links l WHERE l.duplicate_id=s.id)) OR s.source=$4)
    AND ($5='' OR s.result_key=$5) AND ((s.occurred_at >=$1 AND s.occurred_at<$2) OR (o.paid_at >=$1 AND o.paid_at<$2))`,[fromPrevious,window.end,quiz,source,result]);
  const configs=await db.query('SELECT content FROM quiz_configs WHERE quiz_id=$1 ORDER BY created_at DESC',[quiz]);
  const questions=[];const questionKeys=new Set();for(const c of configs)for(const q of c.content.questions||[])if(!questionKeys.has(q.key)){questions.push(q);questionKeys.add(q.key);}
  const [orderCheck]=await db.query("SELECT status,details,checked_at FROM quiz_checks WHERE key='orders'");
  const ordersAvailable=orderCheck?.status==='ok'&&orderCheck.details?.complete===true&&Date.now()-Date.parse(orderCheck.checked_at)<15*60000;
  const [orderState]=await db.query("SELECT payload FROM quiz_sync_state WHERE key='orders'");
  const current=aggregate(rows,window,{source,answerPopulation,orders:orderRows,questions,ordersAvailable});
  current.availability=availability;current.period=input.period==='all'?'all':'custom';current.comparison={status:'off',reason:input.period==='all'?'all_history':'not_requested',message:input.period==='all'?'All available history through yesterday; comparison is off.':null};
  current.revenue=revenueSeries(orderRows,window,{source,available:ordersAvailable&&['native','all'].includes(source)});
  current.revenue.coverage_from=orderState?.payload?.coverage_from||null;
  current.revenue.synced_through=orderState?.payload?.to||null;
  for(const [key,value] of [['coverage_start_date',current.revenue.coverage_from],['coverage_end_date',current.revenue.synced_through]])current.revenue[key]=value?DateTime.fromISO(value).setZone(window.timezone).toISODate():null;
  current.revenue.scope='Exact native quiz attribution only; historical Octane revenue is available only in the saved reference snapshot.';
  const [sync]=await db.query("SELECT count(*) FILTER(WHERE state='pending') AS pending,count(*) FILTER(WHERE state='failed') AS failed,count(*) FILTER(WHERE state='sent') AS sent FROM quiz_outbox");
  const snapshots=await db.query('SELECT payload FROM quiz_reference_snapshots WHERE quiz_id=$1 ORDER BY captured_at DESC LIMIT 1',[quiz]);
  current.reference_snapshot=snapshots[0]?.payload||null;
  current.sync=sync;current.filters={quiz,result,source,answers:answerPopulation};
  if(compareRequested)compareReports(current,aggregate(rows,range({...window,...window.previous}),{source,answerPopulation,orders:orderRows,questions,ordersAvailable}),availability);
  return current;
}
