import { describe, expect, it } from 'vitest';
import { projectGitHubWorkOrders } from '../apps/dashboard/src/github-work-source.js';

describe('GitHub Work Source projection', () => {
  it('projects jobs and groups deterministic commands under one executive initiative', () => {
    const issues = [
      { number: 235, title: 'repair', state: 'open', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/235', updated_at: '2026-09-04T00:03:57Z', body: 'TIGERIQ_JOB_V1\n\n## Instruction\nRepair Web Control\n\n## Priority\nP0' },
      { number: 246, title: 'running', state: 'open', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/246', updated_at: '2026-09-04T00:10:00Z', body: 'TIGERIQ_JOB_V1\n\n## Work Order\nWO-WEB-246\n\n## Instruction\nRun current task\n\n## Priority\nCao' },
      { number: 247, title: 'done', state: 'closed', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/247', updated_at: '2026-09-04T00:11:00Z', body: 'TIGERIQ_JOB_V1\n\n## Work Order\nWO-WEB-247\n\n## Instruction\nFinish current task' },
      { number: 248, title: 'failed', state: 'open', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/248', updated_at: '2026-09-04T00:12:00Z', body: 'TIGERIQ_JOB_V1\n\n## Work Order\nWO-WEB-248\n\n## Instruction\nFail current task' },
      { number: 251, title: 'blocked', state: 'open', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/251', updated_at: '2026-09-04T00:13:00Z', body: 'TIGERIQ_JOB_V1\n\n## Work Order\nWO-WEB-251\n\n## Instruction\nNeeds independent review' },
      { number: 249, title: 'system check', state: 'closed', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/249', updated_at: '2026-09-04T00:14:00Z', body: 'PC01_REQUIRED=true\n\nTIGERIQ_COMMAND_V1\n```json\n{"idempotency_key":"cmd-test-12345678","action":"system.status","args":{}}\n```' },
      { number: 252, title: 'capability check', state: 'closed', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/252', updated_at: '2026-09-04T00:15:00Z', body: 'PC01_REQUIRED=true\n\nTIGERIQ_COMMAND_V1\n```json\n{"idempotency_key":"cmd-test-87654321","action":"system.capabilities","args":{}}\n```' },
      { number: 250, title: 'ambiguous closed job', state: 'closed', body: 'TIGERIQ_JOB_V1\n\n## Instruction\nNo terminal evidence' },
    ];
    const comments = [
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/246', created_at: '2026-09-04T00:10:01Z', body: 'TIGERIQ_PC01_CLAIMED\nworker=pc01' },
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/247', created_at: '2026-09-04T00:11:01Z', body: 'TIGERIQ_PC01_CLAIMED' },
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/247', created_at: '2026-09-04T00:11:02Z', body: 'TIGERIQ_PC01_DONE\n```json\n{"ok":true}\n```' },
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/248', created_at: '2026-09-04T00:12:01Z', body: 'TIGERIQ_PC01_FAILED\nreason=test' },
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/251', created_at: '2026-09-04T00:13:01Z', body: 'TIGERIQ_PC01_NEEDS_EXTERNAL_REVIEW\nthree distinct models required' },
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/249', created_at: '2026-09-04T00:14:01Z', body: 'TIGERIQ_PC01_CLAIMED\nmode=secure-v3-command' },
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/249', created_at: '2026-09-04T00:14:02Z', body: 'TIGERIQ_PC01_DONE\n```json\n{"result":{"ok":true,"action":"system.status"}}\n```' },
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/252', created_at: '2026-09-04T00:15:01Z', body: 'TIGERIQ_PC01_DONE\n```json\n{"result":{"ok":true,"action":"system.capabilities"}}\n```' },
    ];

    const rows = projectGitHubWorkOrders(issues, comments);
    const byId = new Map(rows.map((row) => [row.order.id, row]));

    expect(byId.get('WO-GH-235')?.order.status).toBe('approved');
    expect(byId.get('WO-GH-235')?.order.goal).toBe('Repair Web Control');
    expect(byId.get('WO-WEB-246')?.order.status).toBe('running');
    expect(byId.get('WO-WEB-247')?.order.status).toBe('verified');
    expect(byId.get('WO-WEB-247')?.evidence[0]?.status).toBe('pass');
    expect(byId.get('WO-WEB-247')?.decisions[0]?.status).toBe('pass');
    expect(byId.get('WO-WEB-248')?.order.status).toBe('failed');
    expect(byId.get('WO-WEB-248')?.evidence[0]?.status).toBe('fail');
    expect(byId.get('WO-WEB-251')?.order.status).toBe('blocked');
    expect(byId.get('WO-WEB-251')?.decisions[0]?.status).toBe('blocked');

    const executive = byId.get('INITIATIVE-PC01-AUTOMATION');
    expect(executive?.order.status).toBe('verified');
    expect(executive?.order.goal).toContain('Mục tiêu:');
    expect(executive?.order.goal).toContain('Hạng mục:');
    expect(executive?.order.goal).toContain('Bước hiện tại: Kiểm tra năng lực hệ thống');
    expect(executive?.order.goal).toContain('Mốc kế tiếp:');
    expect(executive?.evidence).toHaveLength(2);
    expect(executive?.evidence.map((item) => item.artifactUris?.[0])).toEqual([
      'https://github.com/newsdayads/tigeriq-ai-lab/issues/249',
      'https://github.com/newsdayads/tigeriq-ai-lab/issues/252',
    ]);
    expect(byId.has('WO-GH-249')).toBe(false);
    expect(byId.has('WO-GH-252')).toBe(false);
    expect(byId.has('WO-GH-250')).toBe(false);
  });

  it('keeps an active technical command as the single parent initiative instead of a second executive goal', () => {
    const issues = [
      { number: 260, state: 'open', updated_at: '2026-09-04T00:20:00Z', body: 'TIGERIQ_COMMAND_V1\n```json\n{"idempotency_key":"cmd-running-12345678","action":"tigeriq.task.status","args":{}}\n```' },
      { number: 261, state: 'closed', updated_at: '2026-09-04T00:19:00Z', body: 'TIGERIQ_COMMAND_V1\n```json\n{"idempotency_key":"cmd-done-12345678","action":"system.status","args":{}}\n```' },
    ];
    const comments = [
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/260', created_at: '2026-09-04T00:20:01Z', body: 'TIGERIQ_PC01_CLAIMED' },
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/261', created_at: '2026-09-04T00:19:01Z', body: 'TIGERIQ_PC01_DONE' },
    ];

    const rows = projectGitHubWorkOrders(issues, comments);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.order.id).toBe('INITIATIVE-PC01-AUTOMATION');
    expect(rows[0]?.order.status).toBe('running');
    expect(rows[0]?.order.goal).toContain('Bước hiện tại: Đọc trạng thái công việc');
  });

  it('uses the latest exact lifecycle marker instead of keyword matches inside evidence prose', () => {
    const issues = [{ number: 300, state: 'open', body: 'TIGERIQ_JOB_V1\n\n## Instruction\nLifecycle test' }];
    const comments = [
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/300', created_at: '2026-09-04T01:00:00Z', body: 'TIGERIQ_PC01_DONE' },
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/300', created_at: '2026-09-04T01:01:00Z', body: 'TIGERIQ_PC01_CLAIMED\nprose mentions TIGERIQ_PC01_FAILED but not as an exact marker line' },
    ];
    const [row] = projectGitHubWorkOrders(issues, comments);
    expect(row?.order.status).toBe('running');
    expect(row?.evidence).toHaveLength(0);
  });

  it('does not let stale closed nonterminal commands override the current executive step', () => {
    const issues = [
      { number: 270, state: 'closed', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/270', updated_at: '2026-09-04T00:20:00Z', body: 'TIGERIQ_COMMAND_V1\n```json\n{"idempotency_key":"cmd-blocked-12345678","action":"ollama.status","args":{}}\n```' },
      { number: 271, state: 'closed', html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/271', updated_at: '2026-09-04T00:21:00Z', body: 'TIGERIQ_COMMAND_V1\n```json\n{"idempotency_key":"cmd-current-12345678","action":"system.status","args":{}}\n```' },
    ];
    const comments = [
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/270', created_at: '2026-09-04T00:20:01Z', body: 'TIGERIQ_PC01_NEEDS_EXTERNAL_REVIEW' },
      { issue_url: 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues/271', created_at: '2026-09-04T00:21:01Z', body: 'TIGERIQ_PC01_DONE' },
    ];

    const rows = projectGitHubWorkOrders(issues, comments);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.order.id).toBe('INITIATIVE-PC01-AUTOMATION');
    expect(rows[0]?.order.status).toBe('verified');
    expect(rows[0]?.order.goal).toContain('Bước hiện tại: Kiểm tra sức khỏe PC01');
    expect(rows[0]?.evidence.map((item) => item.artifactUris?.[0])).toEqual([
      'https://github.com/newsdayads/tigeriq-ai-lab/issues/271',
    ]);
  });
});