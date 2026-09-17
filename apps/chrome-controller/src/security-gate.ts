export interface HeartbeatSecuritySignals {
  authRequired?:boolean;
  reauthRequired?:boolean;
  captchaRequired?:boolean;
  rateLimited?:boolean;
  rateLimitCode?:number|string;
  securityBlock?:string|null;
}

export function heartbeatStopReason(hb:HeartbeatSecuritySignals|undefined):string|undefined{
  if(!hb)return;
  if(hb.authRequired)return 'AUTH_REQUIRED';
  if(hb.reauthRequired)return 'REAUTH';
  if(hb.captchaRequired)return 'CAPTCHA';
  if(hb.rateLimited||Number(hb.rateLimitCode)===429)return 'RATE_LIMIT_429';
  const raw=String(hb.securityBlock||'').trim().toUpperCase();
  if(!raw)return;
  if(raw.includes('CAPTCHA'))return 'CAPTCHA';
  if(raw.includes('REAUTH')||raw.includes('VERIFY'))return 'REAUTH';
  if(raw.includes('RATE_LIMIT')||raw.includes('429')||raw.includes('TOO_MANY_REQUESTS'))return 'RATE_LIMIT_429';
  if(raw.includes('SUSPICIOUS')||raw.includes('SECURITY'))return raw.startsWith('BLOCKED_')?raw:'SECURITY_WARNING';
  return raw.startsWith('BLOCKED_')?raw:'SECURITY_BLOCK';
}
