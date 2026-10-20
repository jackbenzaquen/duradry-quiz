export async function recordCheck(db,key,status,details={}){
  await db.query(`INSERT INTO quiz_checks(key,status,details,checked_at) VALUES($1,$2,$3::jsonb,now())
    ON CONFLICT(key) DO UPDATE SET status=EXCLUDED.status,details=EXCLUDED.details,checked_at=now()`,[key,status,JSON.stringify(details)]);
}
export async function state(db,key){return (await db.query('SELECT payload FROM quiz_sync_state WHERE key=$1',[key]))[0]?.payload||{};}
export async function saveState(db,key,payload){await db.query('INSERT INTO quiz_sync_state(key,payload) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[key,JSON.stringify(payload)]);}
