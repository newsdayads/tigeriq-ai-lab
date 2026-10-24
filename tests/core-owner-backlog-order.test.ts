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

const singleBoardFixture=`# TIGERIQ — HÀNG ĐỢI ĐIỀU HÀNH DUY NHẤT
**Đối chiếu nguồn GitHub: 16/10/2026.** Chỉ bảng bên dưới là danh mục điều hành hiện hành.

QUEUE_VERSION=OWNER_RECONCILED_SINGLE_BOARD_20261016
SOURCE=GITHUB_MAIN+ISSUE_504+LIVE_OPEN_ISSUE_SEARCH
OPEN_ISSUES_CONFIRMED=12

## 1. Việc giao hàng — P0 (đang bị chặn đúng bước, KHÔNG giả đang chạy)

| Thứ tự | Thẻ gốc | Kết quả đã nghiệm thu | Chỉ còn việc phải làm | Trạng thái |
| --- | --- | --- | --- | --- |
| 1 | [#4902 — Core + Coding Lane G6](https://github.com/newsdayads/tigeriq-ai-lab/issues/4902) | 5/6 mốc | E2E | BLOCKED |
| 2 | [#4783 — NV07 Antigravity S6–S7](https://github.com/newsdayads/tigeriq-ai-lab/issues/4783) | 8/10 mốc | S6/S7 | BLOCKED |

## 2. Bốn thẻ P0 quản trị
| Thẻ | Vai trò | Cách dùng |
| --- | --- | --- |
| [#504 — Chính sách](https://github.com/newsdayads/tigeriq-ai-lab/issues/504) | Tra cứu | Quy tắc |

## 3. Công việc sản phẩm P2 — chuyển sang phần làm được nếu P0 chạm cổng thực
| Ưu tiên sau P0 | Thẻ | Bước có thể làm ngay / cổng đang chờ |
| --- | --- | --- |
| P2-A | [#2293 — Revenue Lab / Apify](https://github.com/newsdayads/tigeriq-ai-lab/issues/2293) | Rà nguồn |
| P2-B | [#4780 — REA](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780) | Đọc nguồn |
| P2-C | [#4456 — News & Media](https://github.com/newsdayads/tigeriq-ai-lab/issues/4456) | Chờ writer |

## 4. Ba thẻ hệ thống chỉ để theo dõi, không giao việc lập trình
- [#280 — Hàng đợi này](https://github.com/newsdayads/tigeriq-ai-lab/issues/280)

## 5. Thẻ đã đóng — loại khỏi hàng đợi, không mở lại theo nhật ký cũ
CLOSED_NOT_PLANNED: [#4595], [#4661], [#2949], [#4532], [#4696]
CLOSED_COMPLETED: [#4457], [#4625], [#4870]
`;

describe('Canonical Owner backlog order for Core manager',()=>{
  it('recovers exact owner ordering and ignores historical sections',()=>{
    const ids=parseOwnerBacklogOrder(fixture);
    expect(ids).toEqual([4457,3278,4595,4532,2788,4574,4456,3904,3899,4627,4629,4636,4631,4569,4578,2949,4625,2054,2293]);
  });
  it('parses reconciled single board format from updated Issue #280',()=>{
    const ids=parseOwnerBacklogOrder(singleBoardFixture);
    expect(ids).toEqual([4902,4783,2293,4780,4456]);
    expect(objectiveBacklogRank({id:'OBJ-GH-4902'},ids)).toBe(0);
    expect(objectiveBacklogRank({id:'OBJ-GH-4783'},ids)).toBe(1);
    expect(objectiveBacklogRank({id:'OBJ-GH-2293'},ids)).toBe(2);
    expect(objectiveBacklogRank({id:'OBJ-GH-4595'},ids)).toBe(100000);
  });
  it('reads one exact V2 priority block instead of stale markdown sections',()=>{
    const current=[
      '# TIGERIQ — HÀNG ĐỢI ĐIỀU HÀNH DUY NHẤT',
      '<!-- TIGERIQ_OWNER_PRIORITY_V2_BEGIN -->',
      'OWNER_QUEUE_VERSION=20261025',
      'OWNER_PRIORITY_ORDER=#5290 > #5144 > #5235',
      'OWNER_QUEUE_SCOPE=PRIORITY_ONLY_NOT_DISPATCH_PERMISSION',
      '<!-- TIGERIQ_OWNER_PRIORITY_V2_END -->',
      '',
      '## 1. Historical delivery table',
      '| 1 | [#4456 — historical](https://github.com/newsdayads/tigeriq-ai-lab/issues/4456) | STALE |',
      'CORE_ORDER=#4625',
    ].join('\n');
    expect(parseOwnerBacklogOrder(current)).toEqual([5290,5144,5235]);
    expect(objectiveBacklogRank({id:'OBJ-GH-5290'},parseOwnerBacklogOrder(current))).toBe(0);
    expect(objectiveBacklogRank({id:'OBJ-GH-4625'},parseOwnerBacklogOrder(current))).toBe(100000);
  });
  it('fails closed on invalid, duplicated or forged authoritative V2 blocks',()=>{
    const begin='<!-- TIGERIQ_OWNER_PRIORITY_V2_BEGIN -->';
    const end='<!-- TIGERIQ_OWNER_PRIORITY_V2_END -->';
    for(const body of [
      begin+'\nOWNER_PRIORITY_ORDER=#5290 > #5290\n'+end,
      begin+'\nOWNER_PRIORITY_ORDER=#5290 > #evil\n'+end,
      begin+'\nOWNER_PRIORITY_ORDER=#5290\nOWNER_PRIORITY_ORDER=#5144\n'+end,
      begin+'\nOWNER_PRIORITY_ORDER=#5290\n',
      begin+'\nOWNER_PRIORITY_ORDER=#5290\n'+end+'\n'+end,
      end+'\n'+begin+'\nOWNER_PRIORITY_ORDER=#5290',
    ])expect(parseOwnerBacklogOrder(body+'\n'+fixture)).toEqual([]);
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
