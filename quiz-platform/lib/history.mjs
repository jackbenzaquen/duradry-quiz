import {hash} from './security.mjs';
export const legacyResults={
 '/pages/quiz-results-underarms-cream':'trio-cream','/pages/quiz-results-underarms-red':'trio-red',
 '/pages/quiz-results-all-in-cream':'signature-cream','/pages/quiz-results-all-in-red':'signature-red',
 '/pages/quiz-results-body-cream':'body-cream','/pages/quiz-results-body-red':'body-red',
 '/pages/quiz-results-sweat-control-trio-cream':'trio-cream','/pages/quiz-results-sweat-control-trio-red':'trio-red',
 '/pages/quiz-results-signature-starter-kit-cream':'signature-cream','/pages/quiz-results-signature-starter-kit-red':'signature-red',
 '/pages/quiz-results-body-care-starter-kit-cream':'body-cream','/pages/quiz-results-body-care-starter-kit-red':'body-red'
};
const aliases={gift:['Octane_free_gift'],brand:['Octane_current_deo_brand','Current Deo Brand'],dry:['Octane_sweat_parts','Octane sweat parts'],age:['Octane_age','Octane age range'],odor:['Octane_odor_parts','Octane odor parts'],gender:['Octane_gender','Octane gender']};
export function legacyEvent(event){
 const p=event.attributes.event_properties||{},date=event.attributes.datetime;if(!event.id||!date||!Number.isFinite(Date.parse(date)))throw Error('Missing stable event ID or date');
 const answers={};for(const [key,names] of Object.entries(aliases)){const value=names.map(n=>p[n]).find(v=>v!==undefined&&v!==null&&v!=='');if(value===undefined)continue;
 answers[key]=['dry','odor'].includes(key)?String(value).split(',').map(v=>v.trim()).filter(Boolean).map(v=>v==='Underarms'?v:v+' (legacy label)'):value;
 }
 let path;try{path=new URL(p.Octane_results_page||p.redirect_url).pathname;}catch{}
 return {id:'klaviyo_octane:'+event.id,source:'klaviyo_octane',source_id:event.id,quiz_id:'duradry-routine',version:'legacy-unversioned',occurred_at:date,started_at:null,completed_at:date,subject_key:event.relationships?.profile?.data?.id?'klaviyo:'+event.relationships.profile.data.id:null,answers,result_key:legacyResults[path]||null,result_url:p.Octane_results_page||null,analytics_observed:false,email_consent:null,raw_hash:hash(JSON.stringify(event)),is_test:p.Octane_first_name==='Quiz Test'};
}
export function octaneResponse(row,mapping={}){
 if(!row.session_id)throw Error('Missing session_id; legacy CSV needs an explicit column mapping');
 const date=row.started_at||row.completed_at;if(!date||!Number.isFinite(Date.parse(date)))throw Error('Missing ISO timestamp');
 const rawAnswers=typeof row.answers==='string'?JSON.parse(row.answers||'{}'):row.answers||{};
 const answers={};for(const [key,answer] of Object.entries(rawAnswers)){
 const mapped=mapping.fields?.[key];if(!mapped)continue; // Never guess historical field identity.
 if(/email|name|phone/i.test(mapped))continue;
 const value=answer.values?.length?answer.values:answer.value;
 answers[mapped]=Array.isArray(value)?value.map(v=>mapping.values?.[key]?.[v]||String(v)+' (legacy label)'):value;
 }
 const completed=row.status==='completed'||!!row.completed_at;
 if(completed&&(!row.completed_at||!Number.isFinite(Date.parse(row.completed_at))))throw Error('Completed session lacks a valid completion timestamp');
 return {id:'octane:'+row.session_id,source:'octane',source_id:row.session_id,quiz_id:mapping.quiz_id||'duradry-routine',version:String(row.version||'legacy'),occurred_at:date,started_at:row.started_at||null,completed_at:completed?row.completed_at:null,subject_key:row.person_id?'octane:'+row.person_id:null,answers,result_key:mapping.results?.[row.result_page]||null,result_url:row.results_url||null,analytics_observed:!!row.started_at,email_consent:null,raw_hash:hash(JSON.stringify(row)),is_test:false};
}
export async function importRows(db,rows){
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Duplicate import IDs');
 for(let i=0;i<rows.length;i+=500){const batch=rows.slice(i,i+500);const conflicts=await db.query("SELECT s.id FROM quiz_sessions s JOIN jsonb_to_recordset($1::jsonb) AS x(id text,raw_hash text) ON s.id=x.id WHERE s.raw_hash IS DISTINCT FROM x.raw_hash",[JSON.stringify(batch)]);if(conflicts.length)throw Error('An existing history record has changed; review and merge the changed source records explicitly before importing.');}
 let inserted=0;for(let i=0;i<rows.length;i+=500){const batch=rows.slice(i,i+500);
 const r=await db.query(`INSERT INTO quiz_sessions(id,source,source_id,quiz_id,version,occurred_at,started_at,completed_at,subject_key,answers,result_key,result_url,analytics_observed,email_consent,raw_hash,is_test,start_observed,completion_observed,response_flags)
 SELECT id,source,source_id,quiz_id,version,occurred_at,started_at,completed_at,subject_key,answers,result_key,result_url,analytics_observed,email_consent,raw_hash,COALESCE(is_test,false),COALESCE(start_observed,false),COALESCE(completion_observed,false),COALESCE(response_flags,'{}'::jsonb)
 FROM jsonb_to_recordset($1::jsonb) AS x(id text,source text,source_id text,quiz_id text,version text,occurred_at timestamptz,started_at timestamptz,completed_at timestamptz,subject_key text,answers jsonb,result_key text,result_url text,analytics_observed boolean,email_consent boolean,raw_hash text,is_test boolean,start_observed boolean,completion_observed boolean,response_flags jsonb)
 ON CONFLICT DO NOTHING RETURNING id`,[JSON.stringify(batch)]);inserted+=r.length;}
 return {inserted,duplicates:rows.length-inserted};
}
