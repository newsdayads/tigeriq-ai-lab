// #1806 V3.1 — pure browser health model; also executable in Node tests.
(() => {
  const HEALTH_FRESH_MS=30*60*1000;
  const STATUS_ORDER={BUSY:0,READY:1,IDLE:1,ONLINE:1,MANUAL:2,NO_API:2,RATE_LIMITED:3,AUTH_ERROR:4,CONFIG_ERROR:4,CONTRACT_ERROR:4,ERROR:4,WAIT_KEY:5,STALE_ERROR:6,OFFLINE:7,DISABLED:8,PAUSED:8,RETIRED:8,UNASSIGNED:9};

  const timestampAge=(value,now=Date.now())=>{
    const ts=Date.parse(String(value||''));
    return Number.isFinite(ts)?Math.max(0,now-ts):Infinity;
  };

  function resourceHealthTruth(r,now=Date.now()){
    const raw=String(r?.status||r?.health_state||'').toUpperCase();
    const error=String(r?.last_error||r?.lastError||'').toLowerCase();
    const seenAt=r?.last_seen_at||r?.lastSeenAt||r?.updated_at||r?.updatedAt;
    const age=timestampAge(seenAt,now);
    const fresh=age<=HEALTH_FRESH_MS;
    const cooldownAt=Date.parse(String(r?.cooldown_until||r?.cooldownUntil||''));
    const cooling=Number.isFinite(cooldownAt)&&cooldownAt>now;
    if(['BUSY','IDLE','READY','ONLINE'].includes(raw)){
      return {status:raw,current:true,historical:Boolean(error),detail:error?`Lỗi trước đó: ${error} · ${Number.isFinite(age)?Math.round(age/60000):'không rõ'}p trước`:'Đang khỏe',cooling:false};
    }
    if(raw==='RATE_LIMITED'){
      if(cooling||(fresh&&/rate|429|quota/.test(error)))return {status:'RATE_LIMITED',current:true,historical:false,detail:cooling?`Rate limit hiện hành · thử lại ~${Math.max(1,Math.ceil((cooldownAt-now)/60000))}p`:'Rate limit vừa ghi nhận',cooling};
      return {status:'STALE_ERROR',current:false,historical:true,detail:`Rate limit cũ · telemetry ${Number.isFinite(age)?Math.round(age/60000)+'p':'không rõ thời điểm'}`,cooling:false};
    }
    if(raw==='ERROR'){
      if(!fresh)return {status:'STALE_ERROR',current:false,historical:true,detail:`Lỗi cũ: ${error||'unknown'} · telemetry ${Number.isFinite(age)?Math.round(age/60000)+'p':'không rõ thời điểm'}`,cooling:false};
      if(/auth|401|403/.test(error))return {status:'AUTH_ERROR',current:true,historical:false,detail:'Lỗi xác thực hiện hành',cooling:false};
      if(/config|configuration|402/.test(error))return {status:'CONFIG_ERROR',current:true,historical:false,detail:'Lỗi cấu hình hiện hành',cooling:false};
      if(/invalid_response|schema|empty_response|unexpected_response|contract/.test(error))return {status:'CONTRACT_ERROR',current:true,historical:false,detail:'Lỗi response/contract hiện hành',cooling:false};
      return {status:'ERROR',current:true,historical:false,detail:`Lỗi hiện tại: ${error||'unknown'}`,cooling:false};
    }
    return {status:raw||'OFFLINE',current:true,historical:false,detail:error?`Lỗi hiện tại: ${error}`:(raw||'OFFLINE'),cooling:false};
  }

  function performanceRows24h(resources=[]){
    return (Array.isArray(resources)?resources:[]).filter(r=>r?.provider).map(r=>{
      const success=Math.max(0,Number(r?.calls_success_24h)||0);
      const errors=Math.max(0,Number(r?.calls_failure_24h)||0);
      const total=success+errors;
      const latencyMs=Number.isFinite(Number(r?.last_latency_ms))?Math.max(0,Number(r.last_latency_ms)):null;
      return {
        employeeId:String(r?.employee_id||''),
        provider:String(r?.provider||''),
        success,
        errors,
        successRate:total?Math.round(success*1000/total)/10:null,
        latencyMs,
        hasData:total>0||latencyMs!==null
      };
    });
  }

  function currentAlertRows(resources=[]){
    const alertStates=new Set(['RATE_LIMITED','WAIT_KEY','AUTH_ERROR','CONFIG_ERROR','CONTRACT_ERROR','ERROR','OFFLINE']);
    return (Array.isArray(resources)?resources:[]).map(r=>({resource:r,truth:resourceHealthTruth(r)})).filter(x=>x.truth.current&&alertStates.has(x.truth.status));
  }

  globalThis.TigerIqHealthModel={HEALTH_FRESH_MS,STATUS_ORDER,timestampAge,resourceHealthTruth,performanceRows24h,currentAlertRows};
})();
