import {randomUUID} from 'node:crypto';
import {getDb,rateLimit} from './db.mjs';
import {verifyProxy,parseBody,json,hash,stable,privateHash,encrypt} from './security.mjs';
import {loadConfig,validateAnswers,core} from './config.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds=['viewed','started','question_viewed','question_answered','question_skipped','question_back','completed'];
export async function collect(db,payload,config,now=new Date().toISOString()){
  const {session_id,event_id,kind,question_key}=payload;
  if(!uuid.test(session_id)||!uuid.test(event_id)||!kinds.includes(kind))throw Error('Invalid event');
  if(kind!=='completed'&&payload.analytics_allowed!==true)throw Error('Analytics consent required for funnel tracking');
  if(kind.startsWith('question_')&&!config.questions.some(q=>q.key===question_key))throw Error('Unknown question');
  const elapsed=payload.elapsed_ms??null;if(elapsed!==null&&(!Number.isInteger(elapsed)||elapsed<0||elapsed>3600000||!['question_answered','question_skipped','question_back'].includes(kind)))throw Error('Invalid question duration');
  const answers=validateAnswers(config,payload.answers||{},kind==='completed');
  let contact=null;const contactQuestions=config.questions.filter(q=>['email','first_name'].includes(q.role));
  if(kind==='completed'){
    contact={email:String(answers[contactQuestions.find(q=>q.role==='email')?.key]||'').trim().toLowerCase(),first_name:String(answers[contactQuestions.find(q=>q.role==='first_name')?.key]||'')};
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))throw Error('Invalid email');
  }
  const result=kind==='completed'?core.resolve(config,answers):null;if(kind==='completed'&&!result)throw Error('No matching result');
  const analyticsAnswers=Object.create(null);for(const q of config.questions){if(q.role==='email'||q.role==='first_name')continue;if(answers[q.key]!==undefined)analyticsAnswers[q.key]=Array.isArray(answers[q.key])?answers[q.key].map(v=>q.options.find(o=>o.value===v).label):answers[q.key];}
  const digest=hash(stable(payload)),id='native:'+session_id;
  const prior=await db.query('SELECT payload_hash,session_id FROM quiz_events WHERE id=$1',[event_id]);if(prior.length){if(prior[0].payload_hash!==digest||prior[0].session_id!==id)throw Error('Event identifier conflict');return {ok:true,duplicate:true,result_key:result?.key};}
  const existing=await db.query('SELECT quiz_id,version,completed_at FROM quiz_sessions WHERE id=$1',[id]);
  if(existing.length&&(existing[0].completed_at||existing[0].quiz_id!==config.id||existing[0].version!==config.version))throw Error('Session is finalized or belongs to another quiz version');
  const contactHash=contact?privateHash(contact.email):null,cipher=contact?encrypt(contact):null;
  const consent=kind==='completed'?payload.email_marketing_consent===true:null;
  const isTest=!!contact&&(contact.email.endsWith('.invalid')||contact.email.endsWith('@example.com'));
  const saved=await db.transaction([
    ['INSERT INTO quiz_sessions(id,source,source_id,quiz_id,version,occurred_at) VALUES($1,\'native\',$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id',[id,session_id,config.id,config.version,now]],
    ["INSERT INTO quiz_events(id,session_id,kind,question_key,occurred_at,payload_hash,elapsed_ms) SELECT $1,$2,$3,$4,$5,$6,$9 FROM quiz_sessions WHERE id=$2 AND completed_at IS NULL AND quiz_id=$7 AND version=$8 ON CONFLICT DO NOTHING RETURNING id",[event_id,id,kind,question_key||null,now,digest,config.id,config.version,elapsed]],
    [`UPDATE quiz_sessions SET
      started_at=CASE WHEN $3='started' THEN COALESCE(started_at,$4::timestamptz) ELSE started_at END,
      completed_at=CASE WHEN $3='completed' THEN COALESCE(completed_at,$4::timestamptz) ELSE completed_at END,
      analytics_observed=analytics_observed OR $5,
      answers=$6::jsonb,
      result_key=COALESCE($7,result_key), result_url=COALESCE($8,result_url),
      contact_cipher=COALESCE($9,contact_cipher),contact_hash=COALESCE($10,contact_hash),
      subject_key=COALESCE(subject_key,$10),email_consent=COALESCE($11,email_consent),
      consent_at=CASE WHEN $11 THEN $4::timestamptz ELSE consent_at END,is_test=is_test OR $12
      WHERE id=$1 AND completed_at IS NULL AND EXISTS(SELECT 1 FROM quiz_events WHERE id=$2 AND session_id=$1 AND payload_hash=$13)`,
      [id,event_id,kind,now,payload.analytics_allowed===true,JSON.stringify(analyticsAnswers),result?.key||null,result?.url||null,cipher,contactHash,consent,isTest,digest]],
    [`INSERT INTO quiz_outbox(session_id) SELECT $1 WHERE $2='completed' AND NOT $3 AND EXISTS(SELECT 1 FROM quiz_events WHERE id=$4 AND session_id=$1 AND payload_hash=$5) ON CONFLICT DO NOTHING`,[id,kind,isTest,event_id,digest]]
  ]);
  if(!saved[1].length){const [e]=await db.query('SELECT payload_hash,session_id FROM quiz_events WHERE id=$1',[event_id]);if(e?.payload_hash===digest&&e?.session_id===id)return {ok:true,duplicate:true,result_key:result?.key};throw Error('Session is finalized or event identifier conflicts');}
  return {ok:true,result_key:result?.key,queued:kind==='completed'&&!isTest};
}
export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'POST required'});
  try{
    const body=parseBody(req);if(!verifyProxy(req.url,body))return json(res,401,{error:'Invalid signed request'});
    const db=getDb();const ip=String(req.headers['x-forwarded-for']||'unknown').split(',')[0];
    if(!await rateLimit(db,'collect:'+privateHash(ip),120,60))return json(res,429,{error:'Please try again shortly'});
    const config=await loadConfig(db,body.quiz_id,body.version);
    return json(res,200,await collect(db,body,config));
  }catch(error){console.error('Quiz collection failed',error.name);return json(res,422,{error:'Unable to save this submission. Verify quiz version and field values.'});}
}
