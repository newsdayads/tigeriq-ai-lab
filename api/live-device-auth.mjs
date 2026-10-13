// TigerIQ LIVE viewer: stateless, scoped, signed device sessions.
// This only authenticates read-only display. PC01 remains the sole Core authority.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEVICE_COOKIE='__Host-tigeriq_view';
export const SESSION_SECONDS=60*60*24*90;
export const PAIR_MAX_SECONDS=60*10;
const AUDIENCE='tigeriq-ai-lab.vercel.app';
function strongKey(key) { return typeof key==='string' && Buffer.byteLength(key,'utf8')>=48; }
function signature(body,key){return createHmac('sha256',key).update('TIGERIQ_VIEW_V1.'+body).digest('base64url');}
function encode(payload,key){
 if(!strongKey(key))throw Error('VIEW_DEVICE_KEY_NOT_CONFIGURED');
 const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
 return body+'.'+signature(body,key);
}
function verify(token,key,kind,now=Date.now()){
 if(!strongKey(key)||typeof token!=='string'||token.length>1600||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token))return null;
 const parts=token.split('.');
 try{
  const expected=Buffer.from(signature(parts[0],key),'ascii'),actual=Buffer.from(parts[1],'ascii');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
  const payload=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
  const nowSeconds=Math.floor(now/1000),max=kind==='pair'?PAIR_MAX_SECONDS:SESSION_SECONDS;
  if(payload.v!==1||payload.purpose!==kind||payload.aud!==AUDIENCE
    ||!Number.isSafeInteger(payload.iat)||!Number.isSafeInteger(payload.exp)
    ||!Number.isFinite(nowSeconds)||payload.iat>nowSeconds+30
    ||payload.exp<nowSeconds||payload.exp<=payload.iat||payload.exp-payload.iat>max
    ||typeof payload.nonce!=='string'||!/^[A-Za-z0-9_-]{20,128}$/.test(payload.nonce))return null;
  return payload;
 }catch{return null;}
}
export function createPairLinkToken(key,now=Date.now(),ttl=600){
 if(!Number.isInteger(ttl)||ttl<1||ttl>PAIR_MAX_SECONDS)throw Error('INVALID_PAIR_TTL');
 const sec=Math.floor(now/1000);
 return encode({v:1,purpose:'pair',aud:AUDIENCE,iat:sec,exp:sec+ttl,nonce:randomBytes(20).toString('base64url')},key);
}
export function verifyPairLinkToken(token,key,now=Date.now()){return verify(token,key,'pair',now);}
export function createDeviceSession(key,now=Date.now()){
 const sec=Math.floor(now/1000);
 return encode({v:1,purpose:'session',aud:AUDIENCE,iat:sec,exp:sec+SESSION_SECONDS,nonce:randomBytes(20).toString('base64url')},key);
}
export function deviceCookieValue(cookieHeader){
 if(typeof cookieHeader!=='string')return null;
 for(const piece of cookieHeader.split(';')){
  const index=piece.indexOf('=');
  if(index<0)continue;
  if(piece.slice(0,index).trim()===DEVICE_COOKIE)return piece.slice(index+1).trim();
 }
 return null;
}
export function authorizedDevice(cookieHeader,key,now=Date.now()){
 return !!verify(deviceCookieValue(cookieHeader),key,'session',now);
}
export function sessionCookie(value){
 return DEVICE_COOKIE+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+SESSION_SECONDS;
}
