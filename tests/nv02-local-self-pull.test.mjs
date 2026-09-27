import { describe, expect, it } from 'vitest';
import {
  NV02_LOCAL_GITHUB_SELF_PULL,
  activeNv02Lease,
  buildNv02LocalSelfPullPrompt,
  claimNv02WorkOrder,
  noEligibleNv02Work,
  resolveNv02Command02State,
  selectNv02WorkOrder,
} from '../apps/tigeriq-core/nv02-local-self-pull.mjs';

const safe = (extra = '') => [
  'TIGERIQ_EXECUTABLE=true', 'AUTO_QUEUE=INCLUDED', 'CAPABILITY=general', 'RESOURCE_SCOPE=NV02_TEST', extra,
].filter(Boolean).join('\n');
const issue = (number, title, body) => ({ number, title, body });

describe('NV02 local GitHub self-pull contract', () => {
  it('rejects P0 before selection and only selects one P1-P5 role match', () => {
    const result = selectNv02WorkOrder([
      issue(1, '[P0] owner', safe('PRIORITY=P0')),
      issue(2, '[P2] valid', safe('PRIORITY=P2')),
      issue(3, '[P1] valid', safe('PRIORITY=P1\nRESOURCE_SCOPE=NV02_P1')),
    ]);
    expect(result.issue.number).toBe(3);
    expect(selectNv02WorkOrder([issue(4, '[P0] forbidden', safe('PRIORITY=P0'))])).toBeNull();
  });

  it('skips excluded, owner-held, dependency-blocked, and non-NV02 capabilities', () => {
    const base = (n, extra) => issue(n, `[P1] ${n}`, safe(`PRIORITY=P1\nRESOURCE_SCOPE=S${n}\n${extra}`));
    expect(selectNv02WorkOrder([base(1, 'AUTO_QUEUE=EXCLUDED')])).toBeNull();
    expect(selectNv02WorkOrder([base(2, 'OWNER_HOLD=true')])).toBeNull();
    expect(selectNv02WorkOrder([base(3, 'DEPENDS_ON=#99')])).toBeNull();
    expect(selectNv02WorkOrder([base(4, 'CAPABILITY=review')])).toBeNull();
    expect(selectNv02WorkOrder([base(5, '')], { heldScopes: new Set(['S5']) })).toBeNull();
  });

  it('implements command 02 active resume, terminal self-pull, and no-work state', () => {
    expect(resolveNv02Command02State({ currentWorkOrder: '#10', currentCheckpoint: 'cp' })).toMatchObject({ state: 'ACTIVE_RESUME' });
    expect(resolveNv02Command02State({ currentWorkOrder: null })).toMatchObject({ state: 'SELF_PULL', policy: NV02_LOCAL_GITHUB_SELF_PULL });
    expect(noEligibleNv02Work().state).toBe('READY_NO_ELIGIBLE_WORK');
  });

  it('claims once, rejects a second lease, and releases after evidence', async () => {
    const work = issue(20, '[P1] work', safe('PRIORITY=P1'));
    const comments = [];
    const postComment = async (_number, body) => {
      if (body === null) return comments;
      comments.push({ id: comments.length + 1, body });
      return comments;
    };
    const first = await claimNv02WorkOrder({ issue: work, comments, postComment, nowMs: Date.parse('2026-09-27T00:00:00Z') });
    expect(first).toBeTruthy();
    expect(await claimNv02WorkOrder({ issue: work, comments, postComment, nowMs: Date.parse('2026-09-27T00:01:00Z') })).toBeNull();
    expect(activeNv02Lease(comments, Date.parse('2026-09-27T00:01:00Z')).LEASE_ID).toBe(first.leaseId);
    await postComment(work.number, `EVIDENCE\nSTATE=DONE\nLEASE_ID=${first.leaseId}`);
    await (await import('../apps/tigeriq-core/nv02-local-self-pull.mjs')).releaseNv02WorkOrder({ issueNumber: work.number, leaseId: first.leaseId, state: 'DONE', postComment });
    expect(activeNv02Lease(comments, Date.parse('2026-09-27T00:01:00Z'))).toBeNull();
    expect(buildNv02LocalSelfPullPrompt(work, first)).toContain('Core không assign/route NV02');
  });
});
