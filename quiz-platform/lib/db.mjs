import {neon} from '@neondatabase/serverless';
let connection;
export function getDb(){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is not configured');
  connection ||= neon(process.env.DATABASE_URL);
  return {query:(text,values=[])=>connection.query(text,values),transaction:queries=>connection.transaction(queries.map(([text,values])=>connection.query(text,values)))};
}
export async function rateLimit(db,key,max=30,seconds=60){
  const rows=await db.query(`INSERT INTO quiz_limits(key,n,expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET n=CASE WHEN quiz_limits.expires_at<now() THEN 1 ELSE quiz_limits.n+1 END,
    expires_at=CASE WHEN quiz_limits.expires_at<now() THEN now()+$2*interval '1 second' ELSE quiz_limits.expires_at END RETURNING n`,[key,seconds]);
  return rows[0].n<=max;
}
