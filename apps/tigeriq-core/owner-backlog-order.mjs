// Canonical Owner backlog order comes from GitHub Issue #280, not local hardcoded issue priority.
export const OWNER_BACKLOG_ISSUE=280;
export const OWNER_BACKLOG_KEYS=['CORE_ORDER','NEWS_ORDER','WORKFLOW_ORDER','OTHER_ORDER'];
export function parseOwnerBacklogOrder(body=''){
  const source=String(body||'');
  const header=source.split(/\n---\s*\n/,1)[0]||'';
  if(!header.includes('## OWNER CURRENT BACKLOG ORDER')||!header.includes('CORE_FIRST=true')&&!header.includes('CORE_ORDER='))return[];
  const ids=[];
  for(const key of OWNER_BACKLOG_KEYS){
    const match=header.match(new RegExp('^'+key+'=(.*)$','m'));
    if(!match)continue;
    for(const token of match[1].split('>')){
      const number=Number(token.trim().replace(/^#/,''));
      if(Number.isInteger(number)&&number>0&&!ids.includes(number))ids.push(number);
    }
  }
  return ids;
}
export function objectiveBacklogRank(objective,order){
  const issue=Number(objective?.metadata?.issueNumber||String(objective?.id||'').match(/(?:GH-|GH_)(\d+)/)?.[1]||0);
  const at=order.indexOf(issue);
  return at<0?100000:at;
}
