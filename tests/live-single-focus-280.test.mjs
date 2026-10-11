import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const html=readFileSync(new URL('../public/command-center.html',import.meta.url),'utf8');
const mirror=readFileSync(new URL('../command-center.html',import.meta.url),'utf8');
const start=html.indexOf('function actionableRows(value)');
const end=html.indexOf('function readLastGood()',start);
if(start<0||end<start)throw new Error('LIVE_FOCUS_SOURCE_MISSING');
const functions=html.slice(start,end);

function renderFilter(rows,filter='action'){
  const scope={
    input:{openWork:rows},
    currentFilter:filter,
    workStatus:(row)=>row.status,
    workPriority:(row)=>row.priority,
  };
  return runInNewContext(functions+'\nnormalizeRows(input)',scope);
}
const row=(number,status='REVIEW',extra={})=>({number,status,priority:'P1',workKind:'WORK',executionEligibility:'PARKED_DEPENDENCY',...extra});
const ids=(rows)=>Array.from(rows,x=>x.number);

describe('Owner one-focus LIVE task board (WIP=1)',()=>{
  it('keeps canonical LIVE HTML mirrors exact',()=>expect(mirror).toBe(html));
  it('shows one Core master and places 18 other eligible work cards in backlog',()=>{
    const all=[row(4631,'REVIEW',{priority:'P0'}),row(4636),row(4457,'BLOCKED'),...Array.from({length:16},(_,i)=>row(5000+i))];
    expect(ids(renderFilter(all))).toEqual([4457]);
    const backlog=ids(renderFilter(all,'backlog'));
    expect(backlog).toHaveLength(18);
    expect(backlog).not.toContain(4457);
    expect(backlog).toContain(4631);
    expect(backlog).toContain(4636);
  });
  it('prefers a real running lease rather than a fabricated working state or parked Core',()=>{
    const all=[row(4457,'BLOCKED'),row(5001,'WORKING',{activeLease:false,activeWorker:'NV08'}),row(5002,'WORKING',{activeLease:true,activeWorker:'NV06'})];
    expect(ids(renderFilter(all))).toEqual([5002]);
  });
  it('takes the next eligible item once Core has truly closed',()=>{
    const all=[row(4631,'REVIEW'),row(3904,'BLOCKED'),row(4500,'QUEUED',{executionEligibility:'READY'})];
    expect(ids(renderFilter(all))).toEqual([4500]);
  });
  it('does not promote governance records, P5 or duplicate copies into focus/backlog',()=>{
    const all=[row(504,'OPEN',{workKind:'SYSTEM'}),row(4653,'OPEN',{priority:'P5'}),row(4457,'BLOCKED'),row(4457,'BLOCKED'),row(4636)];
    expect(ids(renderFilter(all))).toEqual([4457]);
    expect(ids(renderFilter(all,'backlog'))).toEqual([4636]);
  });
  it('preserves review, waiting, owner and running tabs with the full source rows',()=>{
    const all=[row(4457,'BLOCKED'),row(4636,'REVIEW'),row(4631,'OWNER_GATE'),row(4649,'WORKING')];
    expect(ids(renderFilter(all,'review'))).toEqual([4636]);
    expect(ids(renderFilter(all,'waiting'))).toEqual([4457]);
    expect(ids(renderFilter(all,'owner'))).toEqual([4631]);
    expect(ids(renderFilter(all,'running'))).toEqual([4649]);
  });
  it('labels the focus/backlog clearly and does not claim the UI dispatches work',()=>{
    expect(html).toContain('ƯU TIÊN DUY NHẤT');
    expect(html).toContain('data-filter="backlog"');
    expect(html).toContain('id="backlogCount"');
    expect(html).toContain('không tự giao việc');
  });
});
