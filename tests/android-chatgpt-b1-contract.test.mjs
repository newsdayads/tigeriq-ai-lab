import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMobileWorkerApi } from '../apps/tigeriq-core/mobile-worker-api.mjs';

const adapter = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ChatGptB1Automation.java', import.meta.url), 'utf8');
const store = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ChatGptB1RunStore.java', import.meta.url), 'utf8');
const service = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/AccessibilityBridgeService.java', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/MainActivity.java', import.meta.url), 'utf8');
const client = readFileSync(new URL('../apps/android-worker/app/src/main/java/ai/tigeriq/worker/ControllerClient.java', import.meta.url), 'utf8');
const core = readFileSync(new URL('../apps/tigeriq-core/mobile-worker-api.mjs', import.meta.url), 'utf8');
const gradle = readFileSync(new URL('../apps/android-worker/app/build.gradle.kts', import.meta.url), 'utf8');

describe('ChatGPT B1 pilot contract', () => {
  it('uses semantic input/click only and never coordinate gestures', () => {
    expect(adapter).toContain('ACTION_SET_TEXT');
    expect(adapter).toContain('ACTION_CLICK');
    expect(adapter).toContain('isEditable()');
    expect(adapter).toContain('isClickable()');
    expect(adapter).toContain('nearestClickable');
    expect(adapter).toContain('uniqueComposerAction');
    expect(adapter).toContain('bestScore - secondScore >= 20');
    expect(adapter + service).not.toMatch(/dispatchGesture|GestureDescription|getBoundsInScreen|performGlobalAction/);
  });

  it('pins project gate, pacing, exactly-once and bounded recovery state', () => {
    expect(store).toContain('REQUIRED_PROJECT = "TigerIQ AI Lab"');
    expect(store).toContain('MIN_FILL_TO_SEND_MS = 3000L');
    expect(store).toContain('INTER_CYCLE_COOLDOWN_MS = 6000L');
    expect(store).toContain('"WAITING_PROJECT"');
    expect(service).toContain('TYPE_VIEW_CLICKED');
    expect(adapter).toContain('treeContainsExactLabel');
    expect(adapter).toContain('nodeOrAncestorContainsLabel');
    expect(adapter).toContain('searchable(current).contains(wanted)');
    expect(adapter).not.toContain('treeContains(current, label)');
    expect(adapter).toContain('localizedClickableAncestorContainsExactLabel');
    expect(adapter).toContain('boundedSubtreeContainsExactLabel');
    expect(adapter).toContain('seen > maxNodes');
    expect(adapter).not.toContain('rootHasProjectAndVisibleComposer');
    expect(service).toContain('DIRECT_LINEAGE');
    expect(service).toContain('LOCAL_CLICKABLE_SCOPE');
    expect(service).toContain('CLICK_REJECTED');
    expect(service).toContain('maybeBindProjectFromStableContext');
    expect(service).toContain('projectContextRunId');
    expect(service).toContain('clearProjectContextCandidate');
    expect(service).toContain('activeRootPackage');
    expect(service).toContain('isActiveInputMethodPackage');
    expect(service).toContain('DEFAULT_INPUT_METHOD');
    expect(service).toContain('if (root == null) {');
    expect(service).toContain('rootPackage == null || !value.equals(rootPackage.toString())');
    expect(service).toContain('if (getPackageName().equals(value)) return;');
    expect(service.indexOf('clearProjectContextCandidate();')).toBeLessThan(service.indexOf('if (getPackageName().equals(value)) return;'));
    expect(service).toContain('shouldBindRequiredProjectFromStableContext');
    expect(service).toContain('CONTEXT_CANDIDATE');
    expect(service).toContain('STABLE_PROJECT_CONTEXT');
    expect(adapter).toContain('treeContainsExactProjectTitleSignal');
    expect(adapter).toContain('isScrollable()');
    expect(adapter).toContain('isHeading()');
    expect(adapter).toContain('projectSemantic');
    expect(adapter).toContain('titleSemantic');
    expect(adapter).toContain('project_title');
    expect(adapter).toContain('project_header');
    expect(adapter).toContain('project_toolbar');
    expect(adapter).not.toContain('hasProjectTitleStructure');
    expect(adapter).not.toContain('treeContainsExactLabelOutsideClickableNavigation');
    expect(service).toContain('findComposerInput(root) != null');
    expect(service).toContain('markProjectBound');
    expect(adapter).toContain('if (!s.projectBound) return;');
    expect(store).toContain('TIGERIQ_B1_OK_');
    expect(store).toContain('Math.min(10, requestedCycles)');
    expect(store).toContain('s.sentCycle == s.cycle');
    expect(store).toContain('duplicateSendCount');
    expect(service).toContain('MAX_B1_RECOVERIES = 2');
    expect(service).toContain('ChatGptB1RunStore.markRecovery');
  });

  it('keeps B1 outside backlog and GitHub mutation', () => {
    expect(activity).toContain('Chạy 1 test');
    expect(activity).toContain('Chạy 10 test');
    expect(activity).toContain('không ghi GitHub');
    expect(adapter).not.toMatch(/github|lease|task|backlog/i);
  });

  it('reports terminal evidence idempotently to Core', () => {
    expect(client).toContain('/api/mobile/evidence');
    expect(core).toContain('tigeriq_mobile_evidence');
    expect(core).toContain("url.pathname==='/api/mobile/evidence'");
    expect(core).toContain('on conflict do nothing');
  });

  it('emits evidence event once across duplicate POST retries', async () => {
    const token = 'b1-test-token';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    let insertAttempts = 0;
    const events = [];
    const pool = {
      async query(sql) {
        if (sql.startsWith('select * from tigeriq_mobile_devices')) {
          return {
            rowCount: 1,
            rows: [{
              node_id: 'node-b1',
              employee_id: 'NV101',
              credential_id: 'cred-b1',
              token_hash: tokenHash,
              provider: 'ChatGPT',
              department: 'Engineering',
              role: 'Android Worker Pilot',
            }],
          };
        }
        if (sql.startsWith('insert into tigeriq_mobile_evidence')) {
          insertAttempts += 1;
          return insertAttempts === 1
            ? { rowCount: 1, rows: [{ run_id: 'run-b1' }] }
            : { rowCount: 0, rows: [] };
        }
        throw new Error('unexpected sql: ' + sql);
      },
    };
    const handle = createMobileWorkerApi({
      pool,
      event: async (type, data) => events.push({ type, data }),
    });
    const payload = JSON.stringify({
      kind: 'chatgpt_b1',
      runId: 'run-b1',
      seq: 1,
      payload: { state: 'COMPLETE' },
    });
    const request = () => ({
      method: 'POST',
      headers: {
        'x-tigeriq-credential-id': 'cred-b1',
        authorization: 'Bearer ' + token,
      },
      socket: { remoteAddress: '100.64.0.2' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(payload); },
    });
    const response = () => ({
      status: 0,
      body: null,
      writeHead(status) { this.status = status; },
      end(body) { this.body = JSON.parse(body); },
    });

    const first = response();
    const second = response();
    await handle(request(), first, new URL('http://core/api/mobile/evidence'));
    await handle(request(), second, new URL('http://core/api/mobile/evidence'));

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, idempotent: false });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true, idempotent: true });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'MOBILE_WORKER_EVIDENCE',
      data: { nodeId: 'node-b1', employeeId: 'NV101', runId: 'run-b1', seq: 1 },
    });
  });

  it('publishes versionCode 17 for Project context regression hardening', () => {
    expect(gradle).toContain('versionCode = 17');
    expect(gradle).toContain('versionName = "0.17.0-project-context-regression-fix"');
  });
});
