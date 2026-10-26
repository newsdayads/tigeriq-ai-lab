// Canonical Owner backlog order comes from GitHub Issue #280, not local hardcoded issue priority.
export const OWNER_BACKLOG_ISSUE=280;
export const OWNER_BACKLOG_KEYS=['CORE_ORDER','NEWS_ORDER','WORKFLOW_ORDER','OTHER_ORDER'];

export function parseOwnerBacklogOrder(body=''){
  const source=String(body||'');

  // The first authoritative block in #280 is deliberately isolated from
  // historical markdown tables, snapshots and issue-comment examples.
  const begin='<!-- TIGERIQ_OWNER_PRIORITY_V2_BEGIN -->';
  const end='<!-- TIGERIQ_OWNER_PRIORITY_V2_END -->';
  const hasBegin=source.includes(begin),hasEnd=source.includes(end);
  if(hasBegin||hasEnd){
    // A malformed or duplicated authoritative declaration MUST fail closed;
    // silently accepting a stale historical priority is unsafe.
    if(!hasBegin||!hasEnd||source.indexOf(begin)!==source.lastIndexOf(begin)
      ||source.indexOf(end)!==source.lastIndexOf(end))return [];
    const start=source.indexOf(begin)+begin.length,finish=source.indexOf(end);
    if(finish<=start)return [];
    const block=source.slice(start,finish);
    const lines=block.split(/\r?\n/).filter(x=>/^OWNER_PRIORITY_ORDER=/.test(x));
    if(lines.length!==1)return [];
    const raw=lines[0].slice('OWNER_PRIORITY_ORDER='.length).trim();
    const parts=raw.split(/\s*>\s*/);
    if(parts.length<1||parts.length>40)return [];
    const ids=[];
    for(const part of parts){
      if(!/^#[1-9]\d{0,7}$/.test(part))return [];
      const id=Number(part.slice(1));
      if(ids.includes(id))return [];
      ids.push(id);
    }
    return ids;
  }

  // 1. Single-board format (Issue #280 reconciled format: QUEUE_VERSION=OWNER_RECONCILED_SINGLE_BOARD_...)
  if(source.includes('QUEUE_VERSION=OWNER_RECONCILED_SINGLE_BOARD_') || source.includes('TIGERIQ — HÀNG ĐỢI ĐIỀU HÀNH DUY NHẤT')){
    const ids=[];
    const endPos = source.search(/##\s+4\.\s+Ba thẻ hệ thống|##\s+5\.\s+Thẻ đã đóng/i);
    const deliveryContent = endPos > 0 ? source.slice(0, endPos) : source;
    const rows = deliveryContent.matchAll(/\|\s*(?:\d+|P\d-[A-Z])\s*\|\s*\[#(\d+)/gi);
    for(const r of rows){
      const num = Number(r[1]);
      if(Number.isInteger(num) && num > 0 && !ids.includes(num)) {
        ids.push(num);
      }
    }
    if(ids.length > 0) return ids;
  }

  // 2. Legacy format with CORE_ORDER / header
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
