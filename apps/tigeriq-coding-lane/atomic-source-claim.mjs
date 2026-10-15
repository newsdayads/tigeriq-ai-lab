// Atomic PostgreSQL claim for a Coding Lane source step. No new queue/plane:
// use existing tigeriq_coding_jobs, Pg advisory xact locks and transaction.
// Caller must perform overlap/replay check and INSERT within the run callback.
export async function withAtomicCodingSourceClaim(pool,{workOrderId,paths=[],run}={}){
  if(!pool?.connect||typeof run!=='function')throw Error('CODING_ATOMIC_CLAIM_DEPENDENCY_MISSING');
  const key=String(workOrderId||'').trim();
  const files=[...new Set((Array.isArray(paths)?paths:[]).map(x=>String(x||'').trim()))].sort();
  if(!key||key.length>180||!files.length||files.length>8||
     files.some(x=>!x||x.includes('..')||x.startsWith('/')||x.includes('\\')))
    throw Error('CODING_ATOMIC_CLAIM_SCOPE_INVALID');
  const client=await pool.connect();
  let began=false;
  try{
    await client.query('BEGIN');began=true;
    // Lock canonical prefixes, too: a legacy "apps/module" writer and
    // "apps/module/file.mjs" writer overlap even when JSONB path keys differ.
    const prefixes=new Set();
    for(const f of files){
      const parts=f.split('/');
      for(let n=2;n<=parts.length;n++)prefixes.add(parts.slice(0,n).join('/'));
    }
    for(const lockKey of ['coding-work-order:'+key,...[...prefixes].sort().map(f=>'coding-file:'+f)]){
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey]);
    }
    const active=await client.query(
      "select id,paths from tigeriq_coding_jobs where status in ('queued','running','review','waiting_ci','waiting_resource') order by created_at desc limit 2001"
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
