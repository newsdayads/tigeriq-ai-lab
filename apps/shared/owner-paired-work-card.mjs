// Scope-only grant: an explicitly paired TigerIQ LIVE device may submit
// bounded Owner requests on existing work cards. Do not reuse for generic
// GitHub credentials, production commands, or arbitrary Core actions.
import { authorizedDevice } from '../../api/live-device-auth.mjs';

export function authorizedPairedWorkCardDevice(req,options={}){
  const enabled=options.enabled??process.env.TIGERIQ_OWNER_WORK_CARD_PAIRED_DEVICE_MODE;
  const key=options.key??process.env.TIGERIQ_LIVE_DEVICE_KEY;
  if(enabled!=='enabled'||typeof key!=='string'||key.length<48)return false;
  const host=String(req?.headers?.host||'').toLowerCase();
  if(host!=='tigeriq-ai-lab.vercel.app')return false;
  return authorizedDevice(String(req?.headers?.cookie||''),key);
}
