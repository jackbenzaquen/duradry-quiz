import {randomUUID} from 'node:crypto';
import {getDb} from '../lib/db.mjs';
import {equal,json,authorized} from '../lib/security.mjs';
import {syncSession} from '../lib/klaviyo.mjs';
import {recordCheck} from '../lib/monitor-store.mjs';
export const config={maxDuration:60};
export default async function handler(req,res){
  const cron=process.env.CRON_SECRET?.length>=32&&equal(req.headers.authorization,'Bearer '+process.env.CRON_SECRET);
  if(!cron&&!authorized(req,true))return json(res,401,{error:'Unauthorized'});
  const db=getDb(),token=randomUUID();let sent=0,failed=0;
  const locks=await db.query("INSERT INTO quiz_locks(key,token,expires_at) VALUES('sync',$1,now()+interval '120 seconds') ON CONFLICT(key) DO UPDATE SET token=$1,expires_at=now()+interval '120 seconds' WHERE quiz_locks.expires_at<now() RETURNING token",[token]);
  if(!locks.length)return json(res,200,{busy:true});
  const start=Date.now();
  try{
    const jobs=await db.query("SELECT * FROM quiz_outbox WHERE state='pending' AND available_at<=now() ORDER BY available_at LIMIT 20");
    for(const job of jobs){if(Date.now()-start>20000)break;
      try{await syncSession(db,job);sent++;}catch(error){failed++;await db.query("UPDATE quiz_outbox SET attempts=attempts+1,state=CASE WHEN attempts>=9 THEN 'failed' ELSE 'pending' END,available_at=now()+LEAST(3600,power(2,attempts+1)*30)*interval '1 second',last_error=$2,updated_at=now() WHERE session_id=$1",[job.session_id,error.status?'Klaviyo HTTP '+error.status:'Sync failed; check configuration']);}
    }
    await recordCheck(db,'sync',failed?'warning':'ok',{sent,failed});
  }catch(error){await recordCheck(db,'sync','error',{message:'Worker failed; inspect configuration.'}).catch(()=>{});throw error;}
  finally{await db.query("DELETE FROM quiz_locks WHERE key='sync' AND token=$1",[token]);}
  return json(res,200,{sent,failed});
}
