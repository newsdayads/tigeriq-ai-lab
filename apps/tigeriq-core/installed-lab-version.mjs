// PC01 read-only installed-version label. The atomic updater writes source
// state after a gated install. Never manufacture a release from browser time.
import {readFileSync} from 'node:fs';
export const PC01_RELEASE_STATE='D:\\TigerIQ\\State\\core-runtime-source.json';
export function formatInstalledLabVersion(state){
 if(!state || !/^[0-9a-f]{40}$/i.test(String(state.currentSha||'')))return null;
 const value=String(state.updatedAt||'');
 if(!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}/.test(value))return null;
 const when=new Date(value);
 if(!Number.isFinite(when.getTime()))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Ho_Chi_Minh',year:'2-digit',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(when).map(p=>[p.type,p.value]));
 return 'LAB'+parts.day+parts.month+parts.year+'-'+parts.hour+parts.minute;
}
export function installedLabVersion(stateFile=PC01_RELEASE_STATE){
 try{return formatInstalledLabVersion(JSON.parse(readFileSync(stateFile,'utf8')))||'CHƯA XÁC MINH';}
 catch{return 'CHƯA XÁC MINH';}
}
