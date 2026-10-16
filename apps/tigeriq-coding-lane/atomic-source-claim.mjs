// Atomic PostgreSQL claim for a Coding Lane source step. No new queue/plane:
// use existing tigeriq_coding_jobs, Pg advisory xact locks and transaction.
// Caller must perform overlap/replay check and INSERT within the run callback.
export async function withAtomicCodingSourceClaim(pool,{workOrderId,paths=[],run}={}){
  if(!pool?.connect||typeof run!=='function')throw Error('CODING_ATOMIC_CLAIM_DEPENDENCY_MISSING');
  const key=String(workOrderId||'').trim();
  const files=[...new Set((Array.isArray(paths)?paths:[]).map(x=>String(x||'').trim()))].sort();
  if(!key||key.length>180||!files.length||files.length>8||
     files.some(x=>!x||x.includes('..')||x.startsWith('/')||x.includes('\\')||x.split('/').some(segment=>!segment||segment==='.' )))
    throw Error('CODING_ATOMIC_CLAIM_SCOPE_INVALID');
  const client=await pool.connect();
  let began=false;
  try{
    await client.query('BEGIN');began=true;
    // Shared locks on ancestors preserve sibling concurrency; exact source
    // scopes take exclusive locks. Include the root to protect "apps" vs "apps/a".
    const prefixes=new Map();
    for(const f of files){
      const parts=f.split('/');
      for(let n=1;n<=parts.length;n++){
        const prefix=parts.slice(0,n).join('/');
        const mode=n===parts.length?'exclusive':'shared';
        if(mode==='exclusive'||!prefixes.has(prefix))prefixes.set(prefix,mode);
      }
    }
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['coding-work-order:'+key]);
    for(const [prefix,mode] of [...prefixes].sort(([a],[b])=>a.localeCompare(b))){
      const functionName=mode==='exclusive'?'pg_advisory_xact_lock':'pg_advisory_xact_lock_shared';
      await client.query(`select ${functionName}(hashtextextended($1,0))`,['coding-file:'+prefix]);
    }
    // Serialize the check+insert against unmodified legacy INSERTs too. A
    // PostgreSQL advisory lock alone cannot fence a writer that ignores it.
    // This short xact table lock waits for uncommitted legacy inserts before
    // reading the writer set and remains held until our INSERT commits.
    await client.query('LOCK TABLE tigeriq_coding_jobs IN SHARE ROW EXCLUSIVE MODE');
    const active=await client.query(
      "select id,paths from tigeriq_coding_jobs where status in ('queued','running','review','waiting_ci','waiting_resource','waiting_owner') order by created_at desc limit 2001"
    );
    if((active.rows||[]).length>=2001)throw Error('CODING_ACTIVE_WRITER_SCAN_INCOMPLETE');
    const conflicting=(active.rows||[]).find(row=>{
      if(!Array.isArray(row.paths))throw Error('CODING_ACTIVE_WRITER_PATHS_UNVERIFIED');
      return row.paths.some(other=>files.some(f=>{
        const p=String(other||'');
        return f===p||f.startsWith(p.endsWith('/')?p:p+'/')||p.startsWith(f.endsWith('/')?f:f+'/');
      }));
    });
    if(conflicting)throw Object.assign(new Error('CODING_MUTATION_PATH_ALREADY_IN_FLIGHT'),{
      code:'CODING_MUTATION_PATH_ALREADY_IN_FLIGHT',otherJobId:String(conflicting.id||'')
    });
    const value=await run(client);
    await client.query('COMMIT');began=false;
    return value;
  }catch(error){
    if(began){try{await client.query('ROLLBACK')}catch{}}
    throw error;
  }finally{client.release()}
}
