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
    for(const lockKey of ['coding-work-order:'+key,...files.map(f=>'coding-file:'+f)]){
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey]);
    }
    const active=await client.query(
      "select id from tigeriq_coding_jobs where status in ('queued','running','review','waiting_ci','waiting_resource') and paths ?| $1::text[] limit 1",
      [files]
    );
    if((active.rows||[]).length)throw Object.assign(new Error('CODING_MUTATION_PATH_ALREADY_IN_FLIGHT'),{
      code:'CODING_MUTATION_PATH_ALREADY_IN_FLIGHT',otherJobId:String(active.rows[0].id||'')
    });
    const value=await run(client);
    await client.query('COMMIT');began=false;
    return value;
  }catch(error){
    if(began){try{await client.query('ROLLBACK')}catch{}}
    throw error;
  }finally{client.release()}
}
