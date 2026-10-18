import {decrypt} from './security.mjs';
export function eventPayload(session,contact){
  const properties={quiz_id:session.quiz_id,quiz_version:session.version,session_id:session.source_id,source:session.source,result_key:session.result_key,result_url:new URL(session.result_url,'https://duradry.com').href,email_marketing_consent:session.email_consent===true,...Object.fromEntries(Object.entries(session.answers).map(([k,v])=>['answer_'+k.replaceAll('-','_'),v]))};
  return {data:{type:'event',attributes:{properties,time:new Date(session.completed_at).toISOString(),unique_id:'duradry-quiz:'+session.source_id,backfill:session.source!=='native',metric:{data:{type:'metric',attributes:{name:'Duradry Quiz Completed'}}},profile:{data:{type:'profile',attributes:{email:contact.email}}}}}};
}
export function profilePayload(session,contact){
  return {data:{type:'profile',attributes:{email:contact.email,properties:{dd_quiz_last_completed_at:new Date(session.completed_at).toISOString(),dd_quiz_id:session.quiz_id,dd_quiz_version:session.version,dd_quiz_first_name:contact.first_name,dd_quiz_result:session.result_key,dd_quiz_results_url:new URL(session.result_url,'https://duradry.com').href,...Object.fromEntries(Object.entries(session.answers).map(([k,v])=>['dd_quiz_'+k.replaceAll('-','_'),v]))}}}};
}
export async function klaviyo(path,body){
  if(!process.env.KLAVIYO_PRIVATE_KEY)throw Error('Klaviyo is not configured');
  const response=await fetch('https://a.klaviyo.com/api/'+path,{method:'POST',headers:{Authorization:'Klaviyo-API-Key '+process.env.KLAVIYO_PRIVATE_KEY,revision:'2026-10-15','Content-Type':'application/vnd.api+json',accept:'application/vnd.api+json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!response.ok){const err=Error('Klaviyo HTTP '+response.status);err.status=response.status;throw err;}
  return response.status===204||response.status===202?null:response.json();
}
export async function syncSession(db,job,send=klaviyo){
  const [session]=await db.query('SELECT * FROM quiz_sessions WHERE id=$1',[job.session_id]);
  if(!session||session.source!=='native'||session.is_test)throw Error('Only real native submissions enter the live sync queue');
  const contact=decrypt(session.contact_cipher);
  if(!job.profile_done){
    const [latest]=await db.query('SELECT * FROM quiz_sessions WHERE contact_hash=$1 AND completed_at IS NOT NULL ORDER BY completed_at DESC,id DESC LIMIT 1',[session.contact_hash]);
    const result=await send('profile-import/',profilePayload(latest,decrypt(latest.contact_cipher)));
    if(result?.data?.id)await db.query('UPDATE quiz_sessions SET subject_key=$1 WHERE contact_hash=$2',['klaviyo:'+result.data.id,session.contact_hash]);
    await db.query('UPDATE quiz_outbox SET profile_done=true WHERE session_id=$1',[session.id]);
  }
  if(!job.event_done){await send('events/',eventPayload(session,contact));await db.query('UPDATE quiz_outbox SET event_done=true WHERE session_id=$1',[session.id]);}
  if(!job.consent_done){
    if(session.email_consent===true&&process.env.KLAVIYO_SUBSCRIBE_OPT_INS==='true'){
      if(!process.env.KLAVIYO_LIST_ID)throw Error('Explicit opt-in list required');
      await send('profile-subscription-bulk-create-jobs/',{data:{type:'profile-subscription-bulk-create-job',attributes:{custom_source:'Duradry native quiz',profiles:{data:[{type:'profile',attributes:{email:contact.email,subscriptions:{email:{marketing:{consent:'SUBSCRIBED'}}}}}]}},relationships:{list:{data:{type:'list',id:process.env.KLAVIYO_LIST_ID}}}}});
    }
    await db.query('UPDATE quiz_outbox SET consent_done=true WHERE session_id=$1',[session.id]);
  }
  await db.query("UPDATE quiz_outbox SET state='sent',last_error=null,updated_at=now() WHERE session_id=$1",[session.id]);
}
