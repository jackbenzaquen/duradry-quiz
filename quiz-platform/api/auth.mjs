import {getDb,rateLimit} from '../lib/db.mjs';
import {parseBody,json,sameOrigin,equal,cookie,privateHash} from '../lib/security.mjs';
export default async function handler(req,res){
 if(req.method!=='POST'||!sameOrigin(req))return json(res,403,{error:'Forbidden'});
 try{const body=parseBody(req,1000);const key='login:'+privateHash(String(req.headers['x-forwarded-for']||'unknown').split(',')[0]);
 if(!await rateLimit(getDb(),key,10,900))return json(res,429,{error:'Too many attempts; try later'});
 if(!process.env.DASHBOARD_PASSWORD||process.env.DASHBOARD_PASSWORD.length<16||!equal(body.password,process.env.DASHBOARD_PASSWORD))return json(res,401,{error:'Invalid credentials'});
 res.setHeader('Set-Cookie','dq_session='+cookie()+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800');return json(res,200,{ok:true});
 }catch{return json(res,503,{error:'Dashboard authentication unavailable'});}
}
