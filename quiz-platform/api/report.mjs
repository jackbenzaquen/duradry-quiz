import {getDb} from '../lib/db.mjs';
import {authorized,json} from '../lib/security.mjs';
import {fetchReport} from '../lib/report.mjs';
import {healthSnapshot} from '../lib/health.mjs';
export default async function handler(req,res){
 if(req.method!=='GET')return json(res,405,{error:'GET required'});
 if(!authorized(req))return json(res,401,{error:'Sign in to view reports'});
 try{const db=getDb();const report=await fetchReport(db,Object.fromEntries(new URL(req.url,'https://localhost').searchParams));report.health=await healthSnapshot(db);return json(res,200,report);}
 catch(error){const known=/^(Invalid (source|timezone|date range|answer population)|Use YYYY-MM-DD|More than 100,000)/.test(error.message);console.error('Report request failed',error.name);return json(res,known?422:503,{error:known?error.message:'Reporting is temporarily unavailable. Check the server configuration.'});}
}
