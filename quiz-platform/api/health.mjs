import {getDb} from '../lib/db.mjs';
import {authorized,equal,json,sameOrigin} from '../lib/security.mjs';
import {healthSnapshot,runHealthChecks} from '../lib/health.mjs';
import {randomUUID} from 'node:crypto';
export const config={maxDuration:60};
export default async function handler(req,res){
  const cron=process.env.CRON_SECRET?.length>=32&&equal(req.headers.authorization,'Bearer '+process.env.CRON_SECRET);
  if(!cron&&!authorized(req))return json(res,401,{error:'Sign in to view system health'});
  if(!['GET','POST'].includes(req.method))return json(res,405,{error:'GET or POST required'});
  if(req.method==='POST'&&!cron&&(!authorized(req,true)||(!req.headers.authorization&&!sameOrigin(req))))return json(res,403,{error:'Authorized same-origin request required'});
  const db=getDb(),token=randomUUID();let locked=false;
  try{
    if(cron||req.method==='POST'){
      const locks=await db.query("INSERT INTO quiz_locks(key,token,expires_at) VALUES('health',$1,now()+interval '90 seconds') ON CONFLICT(key) DO UPDATE SET token=$1,expires_at=now()+interval '90 seconds' WHERE quiz_locks.expires_at<now() RETURNING token",[token]);
      locked=locks.length>0;
    }
    const result=await (locked?runHealthChecks(db):healthSnapshot(db));
    if(result.status!=='ok')console.warn('Quiz health',JSON.stringify({status:result.status,checks:result.checks.filter(c=>c.status!=='ok').map(c=>c.key)}));
    return json(res,200,result);
  }catch{console.error('Quiz health check failed');return json(res,503,{status:'error',error:'Health check unavailable; inspect database and deployment configuration.'});}
  finally{if(locked)await db.query("DELETE FROM quiz_locks WHERE key='health' AND token=$1",[token]).catch(()=>{});}
}
