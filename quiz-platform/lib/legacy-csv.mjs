import {DateTime} from 'luxon';
import {legacyResults} from './history.mjs';
import {hash,stable} from './security.mjs';
export const csvFields={welcome:"Let's jump in when you are ready!",gift:'Pick your FREE gift!',brand:'Which deodorant brand are you currently using?',dry:'Where do you need help staying dry?',age:'How young are you?',odor:'Where do you need help eliminating odors?',gender:"What's your gender?",email:'What is your email?',first_name:"What's your name?",calculation:'Calculating your results...',result:'Results page'};
export const csvResults={'Sweat Control Trio Cream':'trio-cream','Sweat Control Trio Red':'trio-red','Signature Cream':'signature-cream','Signature Red':'signature-red','Body Care Cream':'body-cream','Body Care Kit Red':'body-red','Default results page':'legacy-default'};
const validResultUrl=value=>{try{const u=new URL(value);return ['https://duradry.com','http://127.0.0.1:9292'].includes(u.origin)&&['/pages/oquiz','/'].includes(u.pathname)&&/^#r=[A-Za-z0-9_-]+$/.test(u.hash)?u.href:null;}catch{return null;}};
export function prepareLegacyCsv(csv,legacyEvents,{timezone}={}){
 if(!timezone)throw Error('Specify the CSV timestamp timezone explicitly');
 if(!csv.length||!Object.hasOwn(csv[0],'Timestamp')||!Object.hasOwn(csv[0],csvFields.dry))throw Error('Unrecognized Duradry response CSV');
 const lookup=new Map();for(const event of legacyEvents){const key=validResultUrl(event.attributes.event_properties['quiz results URL']);if(!key)continue;const group=lookup.get(key)||[];group.push(event);lookup.set(key,group);}
 const rows=[],links=[],occurrences=new Map(),seenIds=new Set(),stats={raw_rows:csv.length,result_rows:0,matched_csv_rows:0,matched_klaviyo_events:0,ambiguous_profile_links:0,test_rows:0,identical_extra_rows:0,result_mismatches:0,matched_timestamp_delta_seconds:[]};
 for(const raw of csv){
  const timestamp=DateTime.fromFormat(raw.Timestamp,'yyyy-MM-dd HH:mm:ss',{zone:timezone});if(!timestamp.isValid)throw Error('Invalid CSV timestamp');
  const url=validResultUrl(raw['Shareable quiz results URL']);if(raw['Shareable quiz results URL']&&!url)throw Error('Unrecognized shareable result URL');
  const matches=url?lookup.get(url)||[]:[],digest=hash(stable(raw)),occurrence=(occurrences.get(digest)||0)+1;occurrences.set(digest,occurrence);if(occurrence>1)stats.identical_extra_rows++;
  const sourceId=url?'result:'+url.split('#r=')[1]:'csv:'+digest+':'+occurrence,id='octane:'+sourceId;if(seenIds.has(id))throw Error('Duplicate result ID in CSV');seenIds.add(id);
  const answers=Object.create(null);for(const key of ['gift','brand','dry','age','odor','gender']){const value=raw[csvFields[key]]?.trim();if(value)answers[key]=['dry','odor'].includes(key)?value.split(',').map(v=>v.trim()):key==='brand'?value:[value];}
  const flags=Object.fromEntries(Object.entries(csvFields).map(([k,v])=>[k,!!raw[v]?.trim()]));
  const consent=raw['What is your email? - Marketing Consent'];if(!['Yes','No','N/A',''].includes(consent))throw Error('Unrecognized consent value');
  const email=(raw[csvFields.email]||'').trim().toLowerCase(),test=email.endsWith('.invalid')||email.endsWith('@example.com')||url?.startsWith('http://127.0.0.1:9292/');
  const profiles=[...new Set(matches.map(e=>e.relationships?.profile?.data?.id).filter(Boolean))];if(profiles.length>1)stats.ambiguous_profile_links++;
  const completeTime=matches.length?matches.map(e=>e.attributes.datetime).sort()[0]:null;
  if(matches.length){stats.matched_csv_rows++;stats.matched_klaviyo_events+=matches.length;stats.matched_timestamp_delta_seconds.push((Date.parse(completeTime)-timestamp.toMillis())/1000);}
  for(const e of matches){let path;try{path=new URL(e.attributes.event_properties.Octane_results_page).pathname;}catch{}if(legacyResults[path]&&csvResults[raw['Results page']]&&legacyResults[path]!==csvResults[raw['Results page']])stats.result_mismatches++;}
  if(flags.result)stats.result_rows++;if(test)stats.test_rows++;
  rows.push({id,source:'octane',source_id:sourceId,quiz_id:'duradry-routine',version:'legacy-csv-unversioned',occurred_at:timestamp.toUTC().toISO(),started_at:null,completed_at:completeTime,start_observed:flags.welcome,completion_observed:flags.result||!!matches.length,response_flags:flags,subject_key:profiles.length===1?'klaviyo:'+profiles[0]:null,answers,result_key:csvResults[raw['Results page']]||null,result_url:null,analytics_observed:flags.welcome,email_consent:consent==='Yes'?true:consent==='No'?false:null,raw_hash:digest,is_test:!!test});
  for(const event of matches)links.push({primary_id:id,duplicate_id:'klaviyo_octane:'+event.id,match_method:'exact_shareable_result_url'});
 }
 const d=stats.matched_timestamp_delta_seconds.sort((a,b)=>a-b);stats.timestamp_check={matched_rows:d.length,min_seconds:d[0],median_seconds:d[Math.floor(d.length/2)],max_seconds:d.at(-1),timezone,interpretation:'CSV timestamp treated as recorded-session time, not an exact start or completion time.'};delete stats.matched_timestamp_delta_seconds;
 stats.first_record=rows.map(r=>r.occurred_at).sort()[0];stats.last_record=rows.map(r=>r.occurred_at).sort().at(-1);
 return {rows,links,stats};
}
export async function importLinks(db,links){
 for(let i=0;i<links.length;i+=500){const conflicts=await db.query(`SELECT l.duplicate_id FROM quiz_session_links l JOIN jsonb_to_recordset($1::jsonb) AS x(primary_id text,duplicate_id text) ON x.duplicate_id=l.duplicate_id WHERE l.primary_id<>x.primary_id`,[JSON.stringify(links.slice(i,i+500))]);if(conflicts.length)throw Error('Conflicting history match; review before import');}
 for(let i=0;i<links.length;i+=500)await db.query(`INSERT INTO quiz_session_links(primary_id,duplicate_id,match_method) SELECT primary_id,duplicate_id,match_method FROM jsonb_to_recordset($1::jsonb) AS x(primary_id text,duplicate_id text,match_method text) ON CONFLICT DO NOTHING`,[JSON.stringify(links.slice(i,i+500))]);
}
