export function staleLeaseRecoveryPlan({attempts=0,maxAttempts=1}={}){
  const currentAttempts=Math.max(0,Math.trunc(Number(attempts)||0));
  const boundedMaxAttempts=Math.max(1,Math.trunc(Number(maxAttempts)||1));
  const nextAttempts=currentAttempts+1;
  return {
    currentAttempts,
    maxAttempts:boundedMaxAttempts,
    nextAttempts,
    exhausted:nextAttempts>=boundedMaxAttempts,
  };
}
