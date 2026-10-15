// Display-only Mobile Worker presence from TigerIQ Core's native mobile table.
// This projection never registers employees, creates dispatchable AI resources,
// claims a lease, or treats a heartbeat as successful job acceptance.
export const MOBILE_HEARTBEAT_FRESH_MS=120_000;

export function projectMobileWorkerPresence(rows=[],{nowMs=Date.now()}={}){
  const seen=new Set();
  const result=[];
  for(const row of Array.isArray(rows)?rows:[]){
    const employeeId=String(row?.employee_id||'').trim().toUpperCase();
    if(!/^NV\d{2,4}$/.test(employeeId)||row?.revoked===true||seen.has(employeeId))continue;
    seen.add(employeeId);
    const ms=Date.parse(String(row?.last_seen_at||''));
    const delta=Number(nowMs)-ms;
    const online=Number.isFinite(ms)&&Number.isFinite(delta)&&delta>=-5_000&&delta<=MOBILE_HEARTBEAT_FRESH_MS;
    result.push({
      employeeId,
      provider:String(row?.provider||'mobile').slice(0,40),
      agentVersion:String(row?.agent_version||'').slice(0,80),
      heartbeatAt:Number.isFinite(ms)?new Date(ms).toISOString():null,
      online,
      connectionStatus:online?'ONLINE':'OFFLINE',
      source:'core_mobile_devices',
      // Not a statement about 20 consecutive Core tasks or auto-dispatch readiness.
      coreWorkAccepted:false,
    });
  }
  return result;
}
