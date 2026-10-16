// Work Center projection: all open Issues, plus explicitly bounded recent closed history.
// GitHub's /issues endpoint also returns pull requests. Filter only AFTER paging.
const PAGE_SIZE=100;
export const RECENT_CLOSED_ISSUE_LIMIT=50;

function validIssue(row,state){
  return row&&typeof row==='object'&&!row.pull_request
    &&Number.isInteger(Number(row.number))&&Number(row.number)>0
    &&row.state===state;
}

async function readIssuePages(fetchPage,{state,maxPages,limit}){
  const items=[];
  const seen=new Set();
  for(let page=1;page<=maxPages;page++){
    const rows=await fetchPage(state,page);
    if(!Array.isArray(rows))throw new Error('GITHUB_WORK_ORDERS_PAGE_NOT_ARRAY:'+state+':'+page);
    for(const row of rows){
      if(!validIssue(row,state)||seen.has(Number(row.number)))continue;
      seen.add(Number(row.number));
      items.push(row);
      if(items.length>=limit)
        return {items,pages:page,complete:true,bounded:limit!==Infinity};
    }
    if(rows.length<PAGE_SIZE)
      return {items,pages:page,complete:true,bounded:false};
  }
  return {items,pages:maxPages,complete:false,bounded:limit!==Infinity};
}

// No mutation. Incomplete open-page traversal is an explicit failed-source gate,
// never an assertion that a card missing from the sample has disappeared.
export async function collectGithubWorkOrderIssues({
  fetchPage,maxOpenPages=20,maxClosedPages=20,recentClosedLimit=RECENT_CLOSED_ISSUE_LIMIT,
}={}){
  if(typeof fetchPage!=='function')throw new TypeError('FETCH_PAGE_REQUIRED');
  if(!Number.isInteger(maxOpenPages)||maxOpenPages<1||!Number.isInteger(maxClosedPages)||maxClosedPages<1)
    throw new TypeError('INVALID_PAGE_BUDGET');
  if(!Number.isInteger(recentClosedLimit)||recentClosedLimit<1)throw new TypeError('INVALID_CLOSED_LIMIT');
  const open=await readIssuePages(fetchPage,{state:'open',maxPages:maxOpenPages,limit:Infinity});
  const closed=await readIssuePages(fetchPage,{state:'closed',maxPages:maxClosedPages,limit:recentClosedLimit});
  const items=[...open.items,...closed.items].sort((a,b)=>{
    const at=Date.parse(String(a.updated_at||''))||0;
    const bt=Date.parse(String(b.updated_at||''))||0;
    return bt-at||Number(b.number)-Number(a.number);
  });
  return {
    items,
    sourceScope:{
      openComplete:open.complete,closedHistoryComplete:closed.complete,
      closedHistoryLimit:recentClosedLimit,closedHistoryBounded:closed.bounded,
      openIssues:open.items.length,recentClosedIssues:closed.items.length,
      openPages:open.pages,closedPages:closed.pages,
      source:'GITHUB_ISSUES_OPEN_ALL_PLUS_RECENT_CLOSED',
    },
  };
}

// GitHub closed != product completed. Fail closed when real evidence is missing.
export function closedWorkOrderBucket(issue,steps=[]){
  if(issue?.state!=='closed')return null;
  const body=String(issue.body||'');
  const field=(k)=>body.match(new RegExp('^'+k+'=([^\\r\\n]+)','m'))?.[1]?.trim()||'';
  const finish=Date.parse(field('FINISHED_AT'));
  const verified=issue.state_reason==='completed'
    &&field('DONE').toLowerCase()==='true'
    &&Number.isFinite(finish)
    &&/^https:\/\/github\.com\//.test(field('FINISH_RECEIPT_URL'))
    &&Array.isArray(steps)&&steps.length>0
    &&steps.every(step=>step.checked===true&&Array.isArray(step.evidenceUrls)&&step.evidenceUrls.some(url=>/^https:\/\//.test(url)));
  return verified?'HOÀN THÀNH':'ĐÓNG KHÁC';
}
