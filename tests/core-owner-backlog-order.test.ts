import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error JavaScript runtime helper without TypeScript declaration, covered by runtime tests.
import {parseOwnerBacklogOrder,objectiveBacklogRank} from '../apps/tigeriq-core/owner-backlog-order.mjs';
const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
const fixture=`## OWNER CURRENT BACKLOG ORDER — 2026-10-10
CORE_FIRST=true
CORE_ORDER=#4457 > #3278 > #4595 > #4532 > #2788
NEWS_ORDER=#4574 > #4456 > #3904 > #3899
WORKFLOW_ORDER=#4627 > #4629 > #4636 > #4631
OTHER_ORDER=#4569 > #4578 > #2949 > #4625 > #2054 > #2293

---

Old overrides must not replace current priority
CORE_ORDER=#9999
`;
describe('Canonical Owner backlog order for Core manager',()=>{
  it('recovers exact owner ordering and ignores historical sections',()=>{
    const ids=parseOwnerBacklogOrder(fixture);
    expect(ids).toEqual([4457,3278,4595,4532,2788,4574,4456,3904,3899,4627,4629,4636,4631,4569,4578,2949,4625,2054,2293]);
  });
  it('detects metadata- and ID-based Github objectives',()=>{
    const ids=parseOwnerBacklogOrder(fixture);
    expect(objectiveBacklogRank({id:'OBJ-GH-3278'},ids)).toBe(1);
    expect(objectiveBacklogRank({id:'OBJ-UNKNOWN',metadata:{issueNumber:4457}},ids)).toBe(0);
    expect(objectiveBacklogRank({id:'OBJ-GH-999'},ids)).toBe(100000);
  });
  it('does not adopt stale or missing owner order',()=>{
    expect(parseOwnerBacklogOrder('CORE_ORDER=#123\n')).toEqual([]);
    expect(parseOwnerBacklogOrder('')).toEqual([]);
  });
  it('limits manager admission to P1-P5 and uses owner rank before priority',()=>{
    expect(core).toContain("and o.priority in ('P1','P2','P3','P4','P5')");
    expect(core).toContain('rank:objectiveBacklogRank(objective,ownerOrder)');
    expect(core).toContain('currentOwnerBacklogOrder()');
    expect(core).toContain('o.created_at limit 500');
    expect(core).toContain('GITHUB_TOKEN');
    expect(core).toContain('not exists(select 1 from tigeriq_jobs');
  });
});