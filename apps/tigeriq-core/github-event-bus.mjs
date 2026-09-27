const subscribers=new Set();

export function githubEventIssue(payload={}){
  const issue=payload?.issue;
  if(!issue||!Number.isInteger(Number(issue.number)))return null;
  return issue;
}

export function githubEventNumber(payload={}){
  const issue=githubEventIssue(payload);
  if(issue)return Number(issue.number);
  const pr=payload?.pull_request;
  return pr&&Number.isInteger(Number(pr.number))?Number(pr.number):null;
}

export function subscribeGithubEvents(handler){
  if(typeof handler!=='function')throw new TypeError('GITHUB_EVENT_HANDLER_REQUIRED');
  subscribers.add(handler);
  return ()=>subscribers.delete(handler);
}

export function publishGithubEvent(event={}){
  const envelope={
    eventName:String(event.eventName||'').trim(),
    deliveryId:String(event.deliveryId||'').trim(),
    payload:event.payload&&typeof event.payload==='object'?event.payload:{},
    receivedAt:event.receivedAt||new Date().toISOString(),
  };
  for(const handler of subscribers){
    Promise.resolve().then(()=>handler(envelope)).catch(error=>{
      console.error(JSON.stringify({event:'GITHUB_EVENT_HANDLER_ERROR',eventName:envelope.eventName,deliveryId:envelope.deliveryId,error:String(error?.message||error)}));
    });
  }
  return {subscribers:subscribers.size,issueNumber:githubEventNumber(envelope.payload)};
}
