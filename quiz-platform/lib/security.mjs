import {createHash,createHmac,timingSafeEqual,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export const secret=name=>{const v=process.env[name];if(!v||v.length<32)throw new Error(name+' is missing or too short');return v;};
export const privateHash=value=>createHmac('sha256',secret('APP_SECRET')).update(value).digest('hex');
export function verifyProxy(url,payload,now=Date.now(),key=process.env.SHOPIFY_API_SECRET,shop=process.env.SHOPIFY_STORE){
  if(!key||!shop)return false;
  const params=new URL(url,'https://localhost').searchParams;
  if(params.getAll('signature').length!==1||params.getAll('shop').length!==1||params.getAll('timestamp').length!==1||params.get('shop')!==shop)return false;
  const stamp=Number(params.get('timestamp'));
  if(!Number.isFinite(stamp)||Math.abs(now/1000-stamp)>300)return false;
  const signature=params.get('signature');params.delete('signature');
  const keys=[...new Set(params.keys())];const message=keys.map(k=>k+'='+params.getAll(k).join(',')).sort().join('');
  return equal(signature,createHmac('sha256',key).update(message).digest('hex'))&&equal(params.get('body_hash'),hash(stable(payload)));
}
export function encrypt(contact){const key=Buffer.from(secret('CONTACT_ENCRYPTION_KEY'),'base64');if(key.length!==32)throw Error('CONTACT_ENCRYPTION_KEY must be 32 bytes base64');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(JSON.stringify(contact)),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64')).join('.');}
export function decrypt(value){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64'));const decipher=createDecipheriv('aes-256-gcm',Buffer.from(secret('CONTACT_ENCRYPTION_KEY'),'base64'),iv);decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString());}
export function cookie(){const data=Buffer.from(JSON.stringify({exp:Date.now()+8*3600000,nonce:randomBytes(12).toString('hex')})).toString('base64url');return data+'.'+createHmac('sha256',secret('APP_SECRET')).update(data).digest('base64url');}
export function authorized(req,write=false){
  const expected=write?process.env.ADMIN_API_KEY:process.env.REPORT_API_KEY;
  if(expected?.length>=32&&equal(req.headers.authorization,'Bearer '+expected))return true;
  const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('dq_session='))?.slice(11);
  if(!value)return false;
  const [data,signature]=value.split('.');if(!equal(signature,createHmac('sha256',secret('APP_SECRET')).update(data).digest('base64url')))return false;
  try{return JSON.parse(Buffer.from(data,'base64url')).exp>Date.now();}catch{return false;}
}
export function sameOrigin(req){return !!process.env.APP_ORIGIN&&req.headers.origin===process.env.APP_ORIGIN;}
export function parseBody(req,max=32000){const body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!body||typeof body!=='object'||Buffer.byteLength(JSON.stringify(body))>max)throw Error('Invalid request body');return body;}
export function json(res,status,body){res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json');res.statusCode=status;res.end(JSON.stringify(body));}
