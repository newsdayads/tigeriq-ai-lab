import { describe, expect, it } from 'vitest';
import {
  NV02_LOCAL_GITHUB_SELF_PULL,
  activeResourceClaims,
  activeResourceScopes,
  activeNv02Lease,
  buildNv02LocalSelfPullPrompt,
  claimNv02WorkOrder,
  noEligibleNv02Work,
  resolveNv02Command02State,
  resourceOwnershipConflict,
  selectNv02WorkOrder,
} from '../apps/tigeriq-core/nv02-local-self-pull.mjs';
import { reconcileStaleDependency } from '../apps/tigeriq-core/dependency-reconcile.mjs';

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

  it('skips hard gates but treats capability and role as soft priority only', () => {
    const base = (n, extra) => issue(n, `[P1] ${n}`, safe(`PRIORITY=P1\nRESOURCE_SCOPE=S${n}\n${extra}`));
    expect(selectNv02WorkOrder([base(1, 'AUTO_QUEUE=EXCLUDED')])).toBeNull();
    expect(selectNv02WorkOrder([base(2, 'OWNER_HOLD=true')])).toBeNull();
    expect(selectNv02WorkOrder([base(3, 'DEPENDS_ON=#99')])).toBeNull();
    expect(selectNv02WorkOrder([base(4, 'CAPABILITY=review')])).not.toBeNull();
    expect(selectNv02WorkOrder([base(5, '')], { heldScopes: new Set(['S5']) })).toBeNull();
    expect(selectNv02WorkOrder([base(6, 'CAPABILITY=analysis')]).result.mode).toBe('SAFE_FALLBACK');
    expect(selectNv02WorkOrder([base(7, 'CAPABILITY=analysis\nTARGET_EMPLOYEE=CODING')])).toBeNull();
    expect(selectNv02WorkOrder([base(8, 'CAPABILITY=analysis\nREVIEW_INDEPENDENT=true')])).toBeNull();
    expect(selectNv02WorkOrder([base(9, 'CAPABILITY=coding\nMUTATION_OWNER=CODING')])).not.toBeNull();
    expect(selectNv02WorkOrder([base(10, 'CAPABILITY=security')])).toBeNull();
    expect(selectNv02WorkOrder([base(11, 'TARGET_EMPLOYEE=NV02\nASSIGNED_EXECUTOR=NV09')])).toBeNull();
  });

  it('prefers primary role over safe fallback and rejects active duplicate owner', () => {
    const fallback = issue(30, '[P1] fallback', safe('PRIORITY=P1\nCAPABILITY=research\nRESOURCE_SCOPE=F30'));
    const primary = issue(31, '[P2] primary', safe('PRIORITY=P2\nCAPABILITY=general\nRESOURCE_SCOPE=F31'));
    expect(selectNv02WorkOrder([fallback, primary]).issue.number).toBe(31);
    expect(selectNv02WorkOrder([fallback, primary, issue(32, '[P3] explicit', safe('PRIORITY=P3\nTARGET_EMPLOYEE=NV02\nCAPABILITY=maintenance\nRESOURCE_SCOPE=F32'))]).issue.number).toBe(32);
    expect(selectNv02WorkOrder([fallback], { activeOwners: new Set(['CODING']) })).not.toBeNull();
    expect(selectNv02WorkOrder([issue(32, '[P1] duplicate', safe('PRIORITY=P1\nCAPABILITY=research\nMUTATION_OWNER=CODING\nRESOURCE_SCOPE=F32'))], { activeOwners: new Set(['CODING']) })).toBeNull();
  });

  it('rearms stale dependency state after dependency #2049 closes', async () => {
    const issue2004 = issue(2004, '[P2] stale dependent', 'TIGERIQ_EXECUTABLE=true\nSTATE=WAIT_DEPENDENCY\nDEPENDS_ON=#2049\nMUTATION_OWNER=VY\nRESOURCE_SCOPE=STALE_2004\nGOAL=goal\nACTIVE_INTENT=intent');
    const comments = [];
    let updated = '';
    const guards = [];
    const result = await reconcileStaleDependency({ issue: issue2004, dependencies: new Map([[2049, { state: 'closed', state_reason: 'completed' }]]), assertWriteOwnership: async (action) => guards.push(action), updateBody: async (_n, body) => { updated = body; }, comment: async (_n, body) => comments.push(body) });
    expect(result.action).toBe('REARMED');
    expect(guards).toEqual(['DEPENDENCY_REARM_BODY', 'DEPENDENCY_REARM_COMMENT']);
    expect(updated).toContain('STATE=READY');
    expect(updated).toContain('MUTATION_OWNER=');
    expect(comments[0]).toContain('[DEPENDENCY_REARM]');
  });

  it('records terminal dependency but does not rearm non-executable scope-held #2004', async () => {
    const issue2004 = issue(2004, '[P2] stale pc operator', 'CURRENT_STATE=WAIT_SCOPE_RELEASE_1806_AFTER_2049_DONE\nDEPENDS_ON=#2049\nTIGERIQ_EXECUTABLE=false\nAUTO_QUEUE=EXCLUDED\nCAPABILITY=pc_operator\nRESOURCE_SCOPE=CORE_PC_OPERATOR_PUBLIC_EVIDENCE_PROMPT_V2');
    const comments = [];
    const guards = [];
    const result = await reconcileStaleDependency({ issue: issue2004, dependencies: new Map([[2049, { state: 'closed', state_reason: 'completed' }]]), assertWriteOwnership: async (action) => guards.push(action), comment: async (_n, body) => comments.push(body) });
    expect(result.action).toBe('DEPENDENCY_CLOSED_SCOPE_HELD');
    expect(guards).toEqual(['DEPENDENCY_RECONCILE_COMMENT']);
    expect(comments[0]).toContain('TERMINAL=true');
    expect(comments[0]).toContain('REARM=false');
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
    const first = await claimNv02WorkOrder({ issue: work, comments, postComment, claimSettleMs: 0, nowMs: Date.parse('2026-09-27T00:00:00Z') });
    expect(first).toBeTruthy();
    expect(await claimNv02WorkOrder({ issue: work, comments, postComment, claimSettleMs: 0, nowMs: Date.parse('2026-09-27T00:01:00Z') })).toBeNull();
    expect(activeNv02Lease(comments, Date.parse('2026-09-27T00:01:00Z')).LEASE_ID).toBe(first.leaseId);
    await postComment(work.number, `EVIDENCE\nSTATE=DONE\nLEASE_ID=${first.leaseId}`);
    await (await import('../apps/tigeriq-core/nv02-local-self-pull.mjs')).releaseNv02WorkOrder({ issueNumber: work.number, leaseId: first.leaseId, resourceScope: first.resourceScope, state: 'DONE', postComment });
    expect(activeNv02Lease(comments, Date.parse('2026-09-27T00:01:00Z'))).toBeNull();
    expect(buildNv02LocalSelfPullPrompt(work, first)).toContain('Core không assign/route NV02');
  });

  it('parses App Chrome lowercase scope and release-by-identity correctly', () => {
    const now = Date.parse('2026-09-27T00:00:00Z');
    const claim = { id: 1, body: '[APP_CHROME_CLAIM]\nclaim_id=APP-1\nworker=NV02\nscope=APP_SCOPE\nexpires_at=2026-09-27T01:00:00Z' };
    expect(activeResourceScopes([claim], now)).toEqual(new Set(['APP_SCOPE']));
    expect(activeResourceClaims([claim], now)[0]).toMatchObject({ resourceScope: 'APP_SCOPE', identity: 'APP-1' });
    const release = { id: 2, body: '[APP_CHROME_RELEASE]\nclaim_id=APP-1\nworker=NV02' };
    expect(activeResourceScopes([claim, release], now)).toEqual(new Set());
  });

  it('fails closed before claim when another issue owns the same resource scope', async () => {
    const now = Date.parse('2026-09-27T00:00:00Z');
    const work = issue(50, '[P1] guarded', safe('PRIORITY=P1\nRESOURCE_SCOPE=SHARED_SCOPE'));
    const globalComments = [{
      id: 10,
      body: '[TIGERIQ_ROLE_CLAIM_V1]\nCLAIM_ID=NV09-SHARED\nWORKER=NV09\nRESOURCE_SCOPE=SHARED_SCOPE\nLEASE_UNTIL=2026-09-27T01:00:00Z',
    }];
    const writes = [];
    const conflict = resourceOwnershipConflict(work, globalComments, { nowMs: now });
    expect(conflict).toMatchObject({ reason: 'RESOURCE_SCOPE_HELD', resourceScope: 'SHARED_SCOPE' });
    const lease = await claimNv02WorkOrder({
      issue: work,
      comments: [],
      allComments: globalComments,
      refreshAllComments: async () => globalComments,
      postComment: async (_number, body) => { if (body) writes.push(body); return []; },
      claimSettleMs: 0,
      nowMs: now,
    });
    expect(lease).toBeNull();
    expect(writes).toEqual([]);
  });

  it('uses RESOURCE_SCOPE as the local mutex across different issues', async () => {
    const now = Date.parse('2026-09-27T00:00:00Z');
    const firstComments = [];
    const secondComments = [];
    const firstPost = async (_number, body) => {
      if (body === null) return firstComments;
      firstComments.push({ id: firstComments.length + 1, body });
      return firstComments;
    };
    const secondPost = async (_number, body) => {
      if (body === null) return secondComments;
      secondComments.push({ id: secondComments.length + 1, body });
      return secondComments;
    };
    const firstIssue = issue(60, '[P1] first', safe('PRIORITY=P1\nRESOURCE_SCOPE=SAME_SCOPE'));
    const secondIssue = issue(61, '[P1] second', safe('PRIORITY=P1\nRESOURCE_SCOPE=SAME_SCOPE'));
    const first = await claimNv02WorkOrder({ issue: firstIssue, comments: firstComments, postComment: firstPost, claimSettleMs: 0, nowMs: now });
    expect(first).toBeTruthy();
    expect(await claimNv02WorkOrder({ issue: secondIssue, comments: secondComments, postComment: secondPost, claimSettleMs: 0, nowMs: now })).toBeNull();
    expect(secondComments).toEqual([]);
    await (await import('../apps/tigeriq-core/nv02-local-self-pull.mjs')).releaseNv02WorkOrder({
      issueNumber: firstIssue.number, leaseId: first.leaseId, resourceScope: first.resourceScope, state: 'DONE', postComment: firstPost,
    });
  });

  it('elects the earliest global same-scope claim and releases a losing race', async () => {
    const now = Date.parse('2026-09-27T00:00:00Z');
    const work = issue(70, '[P1] race', safe('PRIORITY=P1\nRESOURCE_SCOPE=RACE_SCOPE'));
    const own = [];
    let refreshCount = 0;
    const competitor = {
      id: 1,
      body: '[TIGERIQ_ROLE_CLAIM_V1]\nCLAIM_ID=NV09-RACE\nWORKER=NV09\nRESOURCE_SCOPE=RACE_SCOPE\nLEASE_UNTIL=2026-09-27T01:00:00Z',
    };
    const postComment = async (_number, body) => {
      if (body === null) return own;
      own.push({ id: own.length + 2, body });
      return own;
    };
    const refreshAllComments = async () => {
      refreshCount += 1;
      return refreshCount < 3 ? [] : [competitor, ...own];
    };
    const lease = await claimNv02WorkOrder({
      issue: work,
      comments: own,
      allComments: [],
      refreshAllComments,
      postComment,
      claimSettleMs: 0,
      nowMs: now,
    });
    expect(lease).toBeNull();
    expect(own.some((comment) => comment.body.includes('STATE=CLAIM_LOST'))).toBe(true);
  });

  it('blocks only live leases and lets released/stale coding work fall back to NV02', () => {
    const now = Date.parse('2026-09-27T00:00:00Z');
    const comments = [
      { id: 1, body: '[TIGERIQ_ROLE_CLAIM_V1]\nWORKER=NV09\nRESOURCE_SCOPE=CODING_RETRY\nLEASE_UNTIL=2026-09-27T01:00:00Z' },
      { id: 2, body: '[TIGERIQ_ROLE_RELEASE_V1]\nWORKER=NV09\nRESOURCE_SCOPE=CODING_RETRY' },
    ];
    expect(activeResourceScopes(comments, now)).toEqual(new Set());
    const released = issue(40, '[P2] coding retry', safe('PRIORITY=P2\nCAPABILITY=coding\nMUTATION_OWNER=NV09\nRESOURCE_SCOPE=CODING_RETRY'));
    expect(selectNv02WorkOrder([released], { heldScopes: activeResourceScopes(comments, now) })).not.toBeNull();
    expect(activeResourceScopes([{ id: 1, body: '[TIGERIQ_ROLE_CLAIM_V1]\nWORKER=NV09\nRESOURCE_SCOPE=CODING_RETRY\nLEASE_UNTIL=2026-09-27T01:00:00Z' }], now)).toEqual(new Set(['CODING_RETRY']));
    expect(activeResourceScopes([
      { id: 1, body: '[TIGERIQ_ROLE_CLAIM_V1]\nWORKER=NV09\nRESOURCE_SCOPE=CODING_RETRY\nLEASE_UNTIL=2026-09-27T01:00:00Z' },
      { id: 2, body: '[TIGERIQ_ROLE_RELEASE_V1]\nWORKER=NV12\nRESOURCE_SCOPE=CODING_RETRY' },
    ], now)).toEqual(new Set(['CODING_RETRY']));
  });
});
