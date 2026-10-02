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
  nv02LeaseAuthority,
  nv02EligibleWorkOrder,
  nv02AuthorityRevision,
  nv02AuthoritativeResumeGuard,
  nv02TakeoverStatus,
  nv02WorkOrderMeta,
  nv02HasTerminalEvidence,
  releaseStaleAssigneeLease,
  releaseNv02WorkOrder,
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
    expect(selectNv02WorkOrder([base(8, 'CAPABILITY=review\nREVIEW_INDEPENDENT=true\nIMPLEMENTER=NV02')])).toBeNull();
    expect(selectNv02WorkOrder([base(9, 'CAPABILITY=coding\nMUTATION_OWNER=CODING')])).not.toBeNull();
    expect(nv02EligibleWorkOrder(base(12, 'CAPABILITY=coding\nOWNER_PROXY=NV02'))).toMatchObject({eligible:false,reason:'INDEPENDENT_CODING_LANE_RESERVED'});
    expect(nv02EligibleWorkOrder(base(13, 'CAPABILITY=coding\nINDEPENDENT_REPAIR_REQUIRED=true'))).toMatchObject({eligible:false,reason:'INDEPENDENT_CODING_LANE_RESERVED'});
    expect(selectNv02WorkOrder([base(14, 'CAPABILITY=coding\nOWNER_PROXY=NV02\nINDEPENDENT_REPAIR_REQUIRED=true')])).toBeNull();
    expect(selectNv02WorkOrder([base(10, 'CAPABILITY=security')])).toBeNull();
    expect(selectNv02WorkOrder([base(11, 'TARGET_EMPLOYEE=NV02\nASSIGNED_EXECUTOR=NV09')])).toBeNull();
  });

  it('opens terminal Coding Lane failures to NV02 without racing a fresh rearm', () => {
    const work = issue(15, '[P1] api repair', safe('PRIORITY=P1\nCAPABILITY=coding\nOWNER_PROXY=NV02\nINDEPENDENT_REPAIR_REQUIRED=true\nRESOURCE_SCOPE=API_REPAIR_15'));
    const failed = [
      { id: 1, created_at: '2026-10-02T12:00:00Z', body: '[PROGRESS] CODEOBJ-a is failed. Implementer: NV11; reviewer: pending. reason=CODING_ALL_BATCHES_NOOP' },
      { id: 2, created_at: '2026-10-02T12:01:00Z', body: '[RETRY_DISPATCHED] CODEOBJ-b prior=CODEOBJ-a attempt=1/2' },
      { id: 3, created_at: '2026-10-02T12:02:00Z', body: '[PROGRESS] CODEOBJ-b is failed. Implementer: NV12; reviewer: pending. reason=CODING_ALL_BATCHES_NOOP' },
      { id: 4, created_at: '2026-10-02T12:03:00Z', body: '[RETRY_DISPATCHED] CODEOBJ-c prior=CODEOBJ-b attempt=2/2' },
      { id: 5, created_at: '2026-10-02T12:04:00Z', body: '[PROGRESS] CODEOBJ-c is failed. Implementer: NV11; reviewer: pending. reason=CODING_ALL_BATCHES_NOOP' },
    ];
    const takeover = nv02TakeoverStatus(work, failed, { nowMs: Date.parse('2026-10-02T12:04:30Z') });
    expect(takeover).toMatchObject({
      eligible: true,
      target: 'CODING_LANE',
      reason: 'INDEPENDENT_CODING_LANE_RETRIES_EXHAUSTED',
      failureCount: 3,
      needsRelease: false,
    });
    expect(selectNv02WorkOrder([work], {
      takeoverStatuses: new Map([[15, takeover]]),
    })?.result).toMatchObject({ eligible: true, mode: 'STALE_ASSIGNEE_TAKEOVER' });

    const rearmed = [...failed, {
      id: 6,
      created_at: '2026-10-02T12:05:00Z',
      body: '[RECOVERY_REARMED] CODEOBJ-d source=abcdef prior=CODEOBJ-c reason=CODING_ALL_BATCHES_NOOP',
    }];
    const activeAgain = nv02TakeoverStatus(work, rearmed, { nowMs: Date.parse('2026-10-02T12:06:00Z') });
    expect(activeAgain).toMatchObject({ eligible: false, reason: 'INDEPENDENT_CODING_LANE_ACTIVE' });
    expect(selectNv02WorkOrder([work], {
      takeoverStatuses: new Map([[15, activeAgain]]),
    })).toBeNull();
    expect(nv02TakeoverStatus(work, rearmed, {
      nowMs: Date.parse('2026-10-02T12:30:00Z'),
    })).toMatchObject({
      eligible: false,
      reason: 'INDEPENDENT_CODING_LANE_ACTIVE',
    });

    const heartbeat = [...rearmed, {
      id: 7,
      created_at: '2026-10-02T12:20:00Z',
      body: '⚙️ [TIẾN ĐỘ] CODEOBJ-d heartbeat ok',
    }];
    expect(nv02TakeoverStatus(work, heartbeat, {
      nowMs: Date.parse('2026-10-02T12:30:00Z'),
    })).toMatchObject({
      eligible: false,
      reason: 'INDEPENDENT_CODING_LANE_ACTIVE',
    });
    expect(nv02TakeoverStatus(work, heartbeat, {
      nowMs: Date.parse('2026-10-02T12:36:00Z'),
    })).toMatchObject({
      eligible: true,
      reason: 'INDEPENDENT_CODING_LANE_PROGRESS_STALE',
      target: 'CODING_LANE',
    });

    const reopened = [...failed, {
      id: 8,
      created_at: '2026-10-02T12:21:00Z',
      body: '⚙️ [TIẾP NHẬN] CODEOBJ-reopen reason=CODING_ALL_BATCHES_NOOP prior=CODEOBJ-c',
    }];
    expect(nv02TakeoverStatus(work, reopened, {
      nowMs: Date.parse('2026-10-02T12:50:00Z'),
    })).toMatchObject({
      eligible: false,
      reason: 'INDEPENDENT_CODING_LANE_ACTIVE',
    });

    const localizedDone = [...failed, {
      id: 9,
      created_at: '2026-10-02T12:22:00Z',
      body: '✅ [KẾT QUẢ] CODEOBJ-d is completed',
    }];
    expect(nv02TakeoverStatus(work, localizedDone, {
      nowMs: Date.parse('2026-10-02T12:50:00Z'),
    })).toMatchObject({
      eligible: false,
      reason: 'INDEPENDENT_CODING_LANE_COMPLETED',
    });

    const terminal = nv02TakeoverStatus(work, [{
      id: 7,
      created_at: '2026-10-02T12:06:00Z',
      body: '[BLOCKED_FINAL] CODEOBJ-z reason=RETRY_BUDGET_EXHAUSTED. CODING_ALL_BATCHES_NOOP',
    }], { nowMs: Date.parse('2026-10-02T12:06:30Z') });
    expect(terminal).toMatchObject({
      eligible: true,
      reason: 'INDEPENDENT_CODING_LANE_TERMINAL_FAILED',
      target: 'CODING_LANE',
    });

    const hard = issue(16, '[P1] api repair hard gate', safe('PRIORITY=P1\nCAPABILITY=coding\nOWNER_PROXY=NV02\nINDEPENDENT_REPAIR_REQUIRED=true\nRESOURCE_SCOPE=API_REPAIR_16\nGOAL=production credential change'));
    expect(selectNv02WorkOrder([hard], {
      takeoverStatuses: new Map([[16, terminal]]),
    })).toBeNull();
  });

  it('keeps a scheduled Coding Lane retry reserved, then falls back when the failed attempt goes stale', () => {
    const work = issue(17, '[P1] api repair stale', safe('PRIORITY=P1\nCAPABILITY=coding\nOWNER_PROXY=NV02\nINDEPENDENT_REPAIR_REQUIRED=true\nRESOURCE_SCOPE=API_REPAIR_17'));
    const firstFailure = [{
      id: 1,
      created_at: '2026-10-02T12:00:00Z',
      body: '⚙️ [TIẾN ĐỘ] CODEOBJ-a is failed. Implementer: NV11; reviewer: pending.',
    }];
    expect(nv02TakeoverStatus(work, firstFailure, {
      nowMs: Date.parse('2026-10-02T12:05:00Z'),
    })).toMatchObject({
      eligible: false,
      reason: 'INDEPENDENT_CODING_LANE_RETRY_BUDGET_OPEN',
    });

    const scheduled = [...firstFailure, {
      id: 2,
      created_at: '2026-10-02T12:06:00Z',
      body: '⏳ [LÊN LỊCH THỬ LẠI] prior=CODEOBJ-a attempt=1/2 nextAt=2026-10-02T12:10:00Z reason=CODING_ALL_BATCHES_NOOP',
    }];
    expect(nv02TakeoverStatus(work, scheduled, {
      nowMs: Date.parse('2026-10-02T12:07:00Z'),
    })).toMatchObject({
      eligible: false,
      reason: 'INDEPENDENT_CODING_LANE_RETRY_SCHEDULED',
    });
    expect(nv02TakeoverStatus(work, scheduled, {
      nowMs: Date.parse('2026-10-02T12:26:00Z'),
    })).toMatchObject({
      eligible: true,
      reason: 'INDEPENDENT_CODING_LANE_SCHEDULE_MISSED',
      target: 'CODING_LANE',
    });

    const stale = nv02TakeoverStatus(work, firstFailure, {
      nowMs: Date.parse('2026-10-02T12:16:00Z'),
    });
    expect(stale).toMatchObject({
      eligible: true,
      reason: 'INDEPENDENT_CODING_LANE_FAILED_STALE',
      target: 'CODING_LANE',
    });
    expect(selectNv02WorkOrder([work], {
      takeoverStatuses: new Map([[17, stale]]),
    })?.result).toMatchObject({ eligible: true, mode: 'STALE_ASSIGNEE_TAKEOVER' });
  });

  it('keeps independent Coding Lane reservation authoritative and never falls back through a hard terminal', () => {
    const reserved = {
      ...issue(18, '[P1] reserved coding', safe('PRIORITY=P1\nCAPABILITY=coding\nOWNER_PROXY=NV02\nINDEPENDENT_REPAIR_REQUIRED=true\nTARGET_EMPLOYEE=NV11\nRESOURCE_SCOPE=API_REPAIR_18')),
      updated_at: '2026-10-02T11:00:00Z',
    };
    const status = nv02TakeoverStatus(reserved, [], { nowMs: Date.parse('2026-10-02T12:00:00Z') });
    expect(status).toMatchObject({
      eligible: false,
      reason: 'INDEPENDENT_CODING_LANE_RESERVED',
      target: 'NV11',
    });
    expect(selectNv02WorkOrder([reserved], {
      takeoverStatuses: new Map([[18, status]]),
    })).toBeNull();

    const hardBlocked = nv02TakeoverStatus(reserved, [{
      id: 1,
      created_at: '2026-10-02T12:01:00Z',
      body: '[BLOCKED_FINAL] CODEOBJ-hard reason=HARD_BLOCKER. DENY_CONTROL_PLANE_MUTATION',
    }], { nowMs: Date.parse('2026-10-02T12:20:00Z') });
    expect(hardBlocked).toMatchObject({
      eligible: false,
      reason: 'INDEPENDENT_CODING_LANE_HARD_BLOCKED',
      target: 'NV11',
    });
    expect(selectNv02WorkOrder([reserved], {
      takeoverStatuses: new Map([[18, hardBlocked]]),
    })).toBeNull();

    for (const reason of ['BROWSER_AUTH', 'AUTHORIZATION_REQUIRED', 'HUMAN_POLICY', 'SCOPE_VIOLATION', 'OUT_OF_SCOPE', 'POLICY_BLOCK']) {
      const localizedHard = nv02TakeoverStatus(reserved, [{
        id: 2,
        created_at: '2026-10-02T12:02:00Z',
        body: `⚠️ [BỊ CHẶN] CODEOBJ-hard reason=${reason}`,
      }], { nowMs: Date.parse('2026-10-02T12:30:00Z') });
      expect(localizedHard).toMatchObject({ eligible: false, reason: 'INDEPENDENT_CODING_LANE_HARD_BLOCKED' });
    }

    const supersededFinal = nv02TakeoverStatus(reserved, [{
      id: 3,
      created_at: '2026-10-02T12:03:00Z',
      body: '⚠️ [BỊ CHẶN] CODEOBJ-old reason=ISSUE_CLOSED_OR_SUPERSEDED',
    }], { nowMs: Date.parse('2026-10-02T12:30:00Z') });
    expect(supersededFinal).toMatchObject({ eligible: false, reason: 'INDEPENDENT_CODING_LANE_HARD_BLOCKED' });

    const supersededWork = {
      ...reserved,
      number: 19,
      state: 'open',
      body: safe('PRIORITY=P1\nCAPABILITY=coding\nOWNER_PROXY=NV02\nINDEPENDENT_REPAIR_REQUIRED=true\nRESOURCE_SCOPE=API_REPAIR_19\nCURRENT_STATE=SUPERSEDED\nTIGERIQ_EXECUTABLE=true\nDONE=false'),
    };
    expect(nv02EligibleWorkOrder(supersededWork, {
      takeoverStatuses: new Map([[19, { eligible: true, reason: 'INDEPENDENT_CODING_LANE_TERMINAL_FAILED' }]]),
    })).toMatchObject({ eligible: false, reason: 'WORK_ORDER_SUPERSEDED_OR_CANCELLED' });
  });

  it('opens independent reservation only on newer explicit C16 stall or no-progress evidence', () => {
    const work = {
      ...issue(20, '[P1] C16 reserved', safe('PRIORITY=P1\nCAPABILITY=coding\nOWNER_PROXY=NV02\nINDEPENDENT_REPAIR_REQUIRED=true\nTARGET_EMPLOYEE=NV11\nRESOURCE_SCOPE=C16_SCOPE')),
      updated_at: '2026-10-02T12:00:00Z',
    };
    const active = [{
      id: 1,
      created_at: '2026-10-02T12:00:00Z',
      body: '[RECOVERY_REARMED] CODEOBJ-c16 prior=CODEOBJ-old reason=CODING_ALL_BATCHES_NOOP',
    }];
    expect(nv02TakeoverStatus(work, active, {
      nowMs: Date.parse('2026-10-02T12:20:00Z'),
    })).toMatchObject({ eligible: false, reason: 'INDEPENDENT_CODING_LANE_ACTIVE' });

    const stalled = [...active, {
      id: 2,
      created_at: '2026-10-02T12:05:00Z',
      body: '[PROGRESS]\nWORKER=NV11\nSTATE=STALLED\nBLOCKER=TRANSPORT_OFFLINE',
    }, {
      id: 3,
      created_at: '2026-10-02T12:05:01Z',
      body: '[TIGERIQ_ROLE_CLAIM_V1]\nCLAIM_ID=NV11-C16\nWORKER=NV11\nRESOURCE_SCOPE=C16_SCOPE\nLEASE_UNTIL=2026-10-02T13:00:00Z',
    }];
    const stalledTakeover = nv02TakeoverStatus(work, stalled, {
      nowMs: Date.parse('2026-10-02T12:06:00Z'),
    });
    expect(stalledTakeover).toMatchObject({
      eligible: true,
      reason: 'ASSIGNEE_STALLED',
      needsRelease: true,
      activeClaim: { worker: 'NV11', resourceScope: 'C16_SCOPE' },
    });
    expect(selectNv02WorkOrder([work], {
      heldScopes: activeResourceScopes(stalled, Date.parse('2026-10-02T12:06:00Z')),
      takeoverStatuses: new Map([[20, stalledTakeover]]),
    })?.result.mode).toBe('STALE_ASSIGNEE_TAKEOVER');

    const rounds = [...active, {
      id: 4,
      created_at: '2026-10-02T12:07:00Z',
      body: '[PROGRESS]\nWORKER=NV11\nNO_PROGRESS_ROUNDS=3',
    }];
    expect(nv02TakeoverStatus(work, rounds, {
      nowMs: Date.parse('2026-10-02T12:08:00Z'),
    })).toMatchObject({ eligible: true, reason: 'NO_PROGRESS_ROUNDS_EXHAUSTED', rounds: 3 });

    const rearmedAfterStall = [...stalled, {
      id: 5,
      created_at: '2026-10-02T12:09:00Z',
      body: '[REOPEN_REARMED] CODEOBJ-c16-new prior=CODEOBJ-c16',
    }];
    expect(nv02TakeoverStatus(work, rearmedAfterStall, {
      nowMs: Date.parse('2026-10-02T12:10:00Z'),
    })).toMatchObject({ eligible: false, reason: 'INDEPENDENT_CODING_LANE_ACTIVE' });
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

  it('requires authoritative state before command 02 resume and self-pulls after terminal refresh', () => {
    const active = {
      ...issue(10, '[P1] active', safe('PRIORITY=P1\nRESOURCE_SCOPE=ACTIVE_10\nCURRENT_STATE=WORKING\nDONE=false')),
      state: 'open',
      state_reason: null,
    };
    const revision = nv02AuthorityRevision(active);
    expect(resolveNv02Command02State({ currentWorkOrder: '#10', currentCheckpoint: 'cp' })).toMatchObject({
      state: 'REFRESH_REQUIRED',
      reason: 'AUTHORITATIVE_ISSUE_REQUIRED',
    });
    expect(resolveNv02Command02State({
      currentWorkOrder: '#10',
      currentCheckpoint: 'cp',
      currentResourceScope: 'ACTIVE_10',
      currentSourceRevision: revision,
      authoritativeIssue: active,
      authoritativeComments: [],
    })).toMatchObject({ state: 'ACTIVE_RESUME', authoritativeRevision: revision });
    expect(resolveNv02Command02State({
      currentWorkOrder: '#10',
      currentResourceScope: 'ACTIVE_10',
      authoritativeIssue: active,
      authoritativeComments: [],
    })).toMatchObject({
      state: 'REFRESH_REQUIRED',
      reason: 'SOURCE_REVISION_REQUIRED',
      archiveAllowed: false,
    });

    const declaredTerminal = {
      ...active,
      body: safe('PRIORITY=P1\nRESOURCE_SCOPE=ACTIVE_10\nCURRENT_STATE=COMPLETED\nDONE=true'),
    };
    expect(nv02AuthoritativeResumeGuard({
      currentWorkOrder: '#10',
      currentResourceScope: 'ACTIVE_10',
      currentSourceRevision: nv02AuthorityRevision(declaredTerminal),
      chatState: 'WAITING_FOR_MERGE',
      authoritativeIssue: declaredTerminal,
      authoritativeComments: [],
    })).toMatchObject({
      valid: false,
      reason: 'AUTHORITATIVE_TERMINAL',
      archiveAllowed: false,
    });

    const terminal = { ...active, state: 'closed', state_reason: 'completed' };
    expect(resolveNv02Command02State({
      currentWorkOrder: '#10',
      currentResourceScope: 'ACTIVE_10',
      currentSourceRevision: revision,
      chatState: 'WAITING_FOR_MERGE',
      chatBlocker: 'PR still needs approval',
      authoritativeIssue: terminal,
      authoritativeComments: [],
    })).toMatchObject({
      state: 'REFRESH_REQUIRED',
      reason: 'AUTHORITATIVE_TERMINAL',
      archiveAllowed: true,
      next: 'SELF_PULL',
    });
    expect(resolveNv02Command02State({ currentWorkOrder: null })).toMatchObject({ state: 'SELF_PULL', policy: NV02_LOCAL_GITHUB_SELF_PULL });
    expect(noEligibleNv02Work().state).toBe('READY_NO_ELIGIBLE_WORK');
  });

  it('blocks stale source revision and carries an authority guard in the NV02 assignment prompt', () => {
    const work = {
      ...issue(2776, '[P1] state guard', safe('PRIORITY=P1\nRESOURCE_SCOPE=NV02_STATE_GUARD\nCURRENT_STATE=READY_AUTO_EXECUTION')),
      state: 'open',
      state_reason: null,
    };
    const currentRevision = nv02AuthorityRevision(work);
    const guard = nv02AuthoritativeResumeGuard({
      currentWorkOrder: '#2776',
      currentResourceScope: 'NV02_STATE_GUARD',
      currentSourceRevision: 'stale-revision',
      authoritativeIssue: work,
      authoritativeComments: [],
    });
    expect(guard).toMatchObject({
      valid: false,
      action: 'REFRESH_REQUIRED',
      reason: 'SOURCE_REVISION_MISMATCH',
      archiveAllowed: false,
      authoritativeRevision: currentRevision,
    });
    const prompt = buildNv02LocalSelfPullPrompt(work, { resourceScope: 'NV02_STATE_GUARD', leaseId: 'lease-1' });
    expect(prompt).toContain(`SOURCE_REVISION=${currentRevision}`);
    expect(prompt).toContain('đọc lại WORK_ORDER authoritative trên GitHub');
    expect(prompt).toContain('không archive nếu chưa có durable terminal evidence');
  });

  it('uses the prepended current authority block instead of stale duplicate metadata below it', () => {
    const work = issue(2475, '[P1] rearmed', [
      '## OWNER REARM — NV02 P1 SAFE WORK — 2026-09-30',
      'CURRENT_STATE=READY_FOR_NV02_SELF_PULL',
      'TIGERIQ_EXECUTABLE=true',
      'AUTO_QUEUE=INCLUDED',
      'TARGET_EMPLOYEE=NV02',
      'RESOURCE_SCOPE=REARMED_SCOPE',
      'REARMED_AT=2026-09-30T13:30:00Z',
      '',
      '## NV02 TERMINAL CHECKPOINT — 2026-09-30',
      'CURRENT_STATE=TERMINAL_BLOCKED_RUNTIME_INVENTORY',
      'TIGERIQ_EXECUTABLE=false',
      'AUTO_QUEUE=EXCLUDED',
      'TARGET_EMPLOYEE=NV17',
      'RESOURCE_SCOPE=STALE_SCOPE',
    ].join('\n'));
    expect(nv02WorkOrderMeta(work)).toMatchObject({
      CURRENT_STATE: 'READY_FOR_NV02_SELF_PULL',
      TIGERIQ_EXECUTABLE: 'true',
      AUTO_QUEUE: 'INCLUDED',
      TARGET_EMPLOYEE: 'NV02',
      RESOURCE_SCOPE: 'REARMED_SCOPE',
    });
    expect(selectNv02WorkOrder([work])?.issue.number).toBe(2475);
  });

  it('ignores terminal evidence before an explicit rearm epoch but honors terminal evidence after it', () => {
    const work = issue(2475, '[P1] rearmed', [
      '## OWNER REARM — NV02 P1 SAFE WORK — 2026-09-30',
      'CURRENT_STATE=READY_FOR_NV02_SELF_PULL',
      'TIGERIQ_EXECUTABLE=true',
      'AUTO_QUEUE=INCLUDED',
      'TARGET_EMPLOYEE=NV02',
      'RESOURCE_SCOPE=REARMED_SCOPE',
      'REARMED_AT=2026-09-30T13:30:00Z',
    ].join('\n'));
    const oldBlocked = [{
      id: 1,
      created_at: '2026-09-30T13:00:00Z',
      body: '[TIGERIQ_NV02_RELEASE_V1]\nWORKER=NV02\nSTATE=BLOCKED',
    }];
    expect(nv02HasTerminalEvidence(work, oldBlocked)).toBe(false);
    const newDone = [...oldBlocked, {
      id: 2,
      created_at: '2026-09-30T13:31:00Z',
      body: '[TIGERIQ_NV02_RELEASE_V1]\nWORKER=NV02\nSTATE=DONE',
    }];
    expect(nv02HasTerminalEvidence(work, newDone)).toBe(true);
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
    expect(first).toMatchObject({ workOrder: '#20', resourceScope: 'NV02_TEST' });
    expect(comments[0].body).toContain('WORK_ORDER=#20');
    expect(await claimNv02WorkOrder({ issue: work, comments, postComment, claimSettleMs: 0, nowMs: Date.parse('2026-09-27T00:01:00Z') })).toBeNull();
    expect(activeNv02Lease(comments, Date.parse('2026-09-27T00:01:00Z')).LEASE_ID).toBe(first.leaseId);
    await postComment(work.number, `EVIDENCE\nSTATE=DONE\nLEASE_ID=${first.leaseId}`);
    await releaseNv02WorkOrder({ issue: work, issueNumber: work.number, leaseId: first.leaseId, resourceScope: first.resourceScope, state: 'DONE', postComment });
    expect(activeNv02Lease(comments, Date.parse('2026-09-27T00:01:00Z'))).toBeNull();
    expect(comments.at(-1).body).toContain('WORK_ORDER=#20');
    const prompt = buildNv02LocalSelfPullPrompt(work, first);
    expect(prompt).toContain('Core không assign/route NV02');
    expect(prompt).toContain('Không tự tạo, mở rộng, claim hoặc allocate scope/resource ngoài Work Order này.');
  });

  it('parses App Chrome lowercase scope and release-by-identity correctly', () => {
    const now = Date.parse('2026-09-27T00:00:00Z');
    const claim = { id: 1, body: '[APP_CHROME_CLAIM]\nclaim_id=App-a1b2\nworker=NV02\nscope=APP_SCOPE\nexpires_at=2026-09-27T01:00:00Z' };
    expect(activeResourceScopes([claim], now)).toEqual(new Set(['APP_SCOPE']));
    expect(activeResourceClaims([claim], now)[0]).toMatchObject({ resourceScope: 'APP_SCOPE', identity: 'App-a1b2' });
    const release = { id: 2, body: '[APP_CHROME_RELEASE]\nclaim_id=App-a1b2\nworker=NV02' };
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
    await releaseNv02WorkOrder({
      issue: firstIssue, issueNumber: firstIssue.number, leaseId: first.leaseId, resourceScope: first.resourceScope, state: 'DONE', postComment: firstPost,
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

  it('fails closed when Work Order authority is missing or drifts', async () => {
    const noScope = issue(80, '[P1] no scope', 'TIGERIQ_EXECUTABLE=true\nAUTO_QUEUE=INCLUDED\nCAPABILITY=general\nPRIORITY=P1');
    const writes = [];
    const lease = await claimNv02WorkOrder({
      issue: noScope,
      comments: [],
      postComment: async (_number, body) => { if (body) writes.push(body); return []; },
      claimSettleMs: 0,
      nowMs: Date.parse('2026-09-27T00:00:00Z'),
    });
    expect(lease).toBeNull();
    expect(writes).toEqual([]);

    const work = issue(81, '[P1] bound', safe('PRIORITY=P1\nRESOURCE_SCOPE=BOUND_SCOPE'));
    expect(nv02LeaseAuthority(work, { workOrder: '#999', resourceScope: 'BOUND_SCOPE' })).toMatchObject({ valid: false, reason: 'WORK_ORDER_MISMATCH' });
    expect(nv02LeaseAuthority(work, { workOrder: '#81', resourceScope: 'OTHER_SCOPE' })).toMatchObject({ valid: false, reason: 'RESOURCE_SCOPE_MISMATCH' });
    expect(nv02LeaseAuthority(work, { workOrder: '#81', resourceScope: 'BOUND_SCOPE' })).toMatchObject({ valid: true });

    await expect(releaseNv02WorkOrder({
      issue: work, issueNumber: 81, leaseId: 'L81', resourceScope: '', state: 'DONE', postComment: async () => null,
    })).rejects.toThrow('NV02_RELEASE_AUTHORITY_INVALID:RESOURCE_SCOPE_MISMATCH');

    const releaseWrites = [];
    await expect(releaseNv02WorkOrder({
      issue: work, issueNumber: 81, leaseId: 'L81', resourceScope: 'OTHER_SCOPE', state: 'DONE',
      postComment: async (_number, body) => releaseWrites.push(body),
    })).rejects.toThrow('NV02_RELEASE_AUTHORITY_INVALID:RESOURCE_SCOPE_MISMATCH');
    expect(releaseWrites).toEqual([]);

    await expect(releaseNv02WorkOrder({
      issueNumber: 81, leaseId: 'L81', resourceScope: 'BOUND_SCOPE', state: 'DONE', postComment: async () => null,
    })).rejects.toThrow('NV02_RELEASE_WORK_ORDER_REQUIRED');
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

  it('allows NV02 takeover only after an assigned employee is stale or has 3 no-progress rounds', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    const assigned = {
      ...issue(90, '[P1] stale assigned', safe('PRIORITY=P1\nTARGET_EMPLOYEE=NV12\nRESOURCE_SCOPE=STALE_ASSIGNED')),
      updated_at: '2026-09-30T11:40:00Z',
    };
    const stale = nv02TakeoverStatus(assigned, [], { nowMs: now });
    expect(stale).toMatchObject({ eligible: true, target: 'NV12', reason: 'ASSIGNEE_HEARTBEAT_STALE' });
    const selected = selectNv02WorkOrder([assigned], {
      takeoverStatuses: new Map([[90, stale]]),
    });
    expect(selected.result.mode).toBe('STALE_ASSIGNEE_TAKEOVER');

    const fresh = {
      ...assigned,
      number: 91,
      updated_at: '2026-09-30T11:55:00Z',
    };
    expect(nv02TakeoverStatus(fresh, [], { nowMs: now })).toMatchObject({ eligible: false, reason: 'ASSIGNEE_STALE_UNPROVEN' });

    const rounds = issue(92, '[P2] stalled rounds', safe('PRIORITY=P2\nTARGET_EMPLOYEE=NV17\nRESOURCE_SCOPE=ROUNDS\nNO_PROGRESS_ROUNDS=3'));
    expect(nv02TakeoverStatus(rounds, [], { nowMs: now })).toMatchObject({
      eligible: true,
      target: 'NV17',
      reason: 'NO_PROGRESS_ROUNDS_EXHAUSTED',
    });
  });

  it('releases a stale live assignee lease before NV02 can claim the same scope', async () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    const work = {
      ...issue(93, '[P1] stale lease', safe('PRIORITY=P1\nTARGET_EMPLOYEE=NV09\nRESOURCE_SCOPE=STALE_SCOPE')),
      updated_at: '2026-09-30T11:30:00Z',
    };
    const comments = [{
      id: 1,
      created_at: '2026-09-30T11:30:00Z',
      body: '[TIGERIQ_ROLE_CLAIM_V1]\nCLAIM_ID=NV09-STALE\nWORKER=NV09\nRESOURCE_SCOPE=STALE_SCOPE\nLEASE_UNTIL=2026-09-30T13:00:00Z',
    }];
    const takeover = nv02TakeoverStatus(work, comments, { nowMs: now });
    expect(takeover).toMatchObject({ eligible: true, needsRelease: true, target: 'NV09' });
    expect(selectNv02WorkOrder([work], {
      heldScopes: activeResourceScopes(comments, now),
      takeoverStatuses: new Map([[93, takeover]]),
    }).result.mode).toBe('STALE_ASSIGNEE_TAKEOVER');

    const postComment = async (_number, body) => {
      comments.push({ id: comments.length + 1, created_at: new Date(now).toISOString(), body });
      return comments.at(-1);
    };
    await releaseStaleAssigneeLease({ issue: work, takeover, postComment, nowMs: now });
    expect(comments.at(-1).body).toContain('STATE=STALE_TAKEOVER_BY_NV02');
    expect(activeResourceScopes(comments, now)).toEqual(new Set());

    const lease = await claimNv02WorkOrder({
      issue: work,
      comments,
      allComments: comments,
      refreshAllComments: async () => comments,
      postComment,
      claimSettleMs: 0,
      nowMs: now,
    });
    expect(lease).toMatchObject({ workOrder: '#93', resourceScope: 'STALE_SCOPE' });
    await releaseNv02WorkOrder({
      issue: work, issueNumber: 93, leaseId: lease.leaseId, resourceScope: lease.resourceScope, state: 'DONE', postComment,
    });
  });

  it('keeps fresh assignee leases, self-review, hard gates and App Chrome fail-closed', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    const freshLeaseWork = issue(94, '[P1] fresh', safe('PRIORITY=P1\nTARGET_EMPLOYEE=NV12\nRESOURCE_SCOPE=FRESH'));
    const freshComments = [{
      id: 1,
      created_at: '2026-09-30T11:55:00Z',
      body: '[TIGERIQ_ROLE_CLAIM_V1]\nWORKER=NV12\nRESOURCE_SCOPE=FRESH\nLEASE_UNTIL=2026-09-30T13:00:00Z',
    }];
    expect(nv02TakeoverStatus(freshLeaseWork, freshComments, { nowMs: now })).toMatchObject({
      eligible: false,
      reason: 'ASSIGNEE_LEASE_FRESH',
    });

    const selfReview = issue(95, '[P1] review', safe('PRIORITY=P1\nCAPABILITY=review\nTARGET_EMPLOYEE=NV12\nREVIEW_INDEPENDENT=true\nIMPLEMENTER=NV02\nRESOURCE_SCOPE=REVIEW_95\nNO_PROGRESS_ROUNDS=3'));
    const selfReviewTakeover = nv02TakeoverStatus(selfReview, [], { nowMs: now });
    expect(selfReviewTakeover).toMatchObject({ eligible: false, reason: 'SELF_REVIEW_FORBIDDEN' });

    const appChrome = issue(96, '[P1] app chrome', safe('PRIORITY=P1\nTARGET_EMPLOYEE=NV12\nRESOURCE_SCOPE=APP_CHROME_SELF_MAINTENANCE\nNO_PROGRESS_ROUNDS=3'));
    const appTakeover = nv02TakeoverStatus(appChrome, [], { nowMs: now });
    expect(selectNv02WorkOrder([appChrome], { takeoverStatuses: new Map([[96, appTakeover]]) })).toBeNull();

    const hard = issue(97, '[P1] credential', safe('PRIORITY=P1\nTARGET_EMPLOYEE=NV12\nRESOURCE_SCOPE=CRED\nGOAL=credential rotation\nNO_PROGRESS_ROUNDS=3'));
    const hardTakeover = nv02TakeoverStatus(hard, [], { nowMs: now });
    expect(selectNv02WorkOrder([hard], { takeoverStatuses: new Map([[97, hardTakeover]]) })).toBeNull();
  });

  it('treats capability as soft but requires an explicit direct path for device-bound pc_operator takeover', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    const blocked = issue(98, '[P1] pc operator', safe('PRIORITY=P1\nCAPABILITY=pc_operator\nTARGET_EMPLOYEE=NV06\nRESOURCE_SCOPE=PC98\nNO_PROGRESS_ROUNDS=3'));
    expect(nv02TakeoverStatus(blocked, [], { nowMs: now })).toMatchObject({
      eligible: false,
      reason: 'NO_NV02_DIRECT_EXECUTION_PATH',
    });

    const direct = issue(99, '[P1] pc operator direct', safe('PRIORITY=P1\nCAPABILITY=pc_operator\nTARGET_EMPLOYEE=NV06\nRESOURCE_SCOPE=PC99\nNO_PROGRESS_ROUNDS=3\nNV02_DIRECT_EXECUTION=true'));
    const takeover = nv02TakeoverStatus(direct, [], { nowMs: now });
    expect(takeover).toMatchObject({ eligible: true, target: 'NV06' });
    expect(selectNv02WorkOrder([direct], { takeoverStatuses: new Map([[99, takeover]]) })).not.toBeNull();
  });

  it('recognizes worker/transport blocked evidence without treating dependency or owner waits as takeover', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    const transport = issue(100, '[P2] transport blocked', safe('PRIORITY=P2\nTARGET_EMPLOYEE=NV17\nRESOURCE_SCOPE=T100'));
    const transportComments = [{
      id: 1,
      created_at: '2026-09-30T11:59:00Z',
      body: '[PROGRESS]\nWORKER=NV17\nSTATE=BLOCKED\nBLOCKER=TRANSPORT_OFFLINE',
    }];
    expect(nv02TakeoverStatus(transport, transportComments, { nowMs: now })).toMatchObject({
      eligible: true,
      reason: 'ASSIGNEE_BLOCKED_WORKER_OR_TRANSPORT',
    });

    const dependency = issue(101, '[P2] dependency blocked', safe('PRIORITY=P2\nTARGET_EMPLOYEE=NV17\nRESOURCE_SCOPE=T101\nDEPENDS_ON=#999'));
    const dependencyComments = [{
      id: 1,
      created_at: '2026-09-30T11:00:00Z',
      body: '[PROGRESS]\nWORKER=NV17\nSTATE=BLOCKED\nBLOCKER=DEPENDENCY_NOT_READY',
    }];
    const status = nv02TakeoverStatus(dependency, dependencyComments, { nowMs: now });
    expect(status.reason).not.toBe('ASSIGNEE_BLOCKED_WORKER_OR_TRANSPORT');
    expect(selectNv02WorkOrder([dependency], {
      dependencies: new Map([[999, false]]),
      takeoverStatuses: new Map([[101, status]]),
    })).toBeNull();
  });
});
