import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const roleMap = readFileSync('docs/governance/TIGERIQ_NV_ROLE_MAP_V1.md', 'utf8');
const resumePolicy = readFileSync('docs/governance/TIGERIQ_NV_SESSION_AUTO_RESUME_V1.md', 'utf8');

describe('TigerIQ NV Role Map V1', () => {
  it('registers every current NV identity exactly by operational lane', () => {
    expect(roleMap).toContain('`NV00` | Chief of Staff / Orchestrator');
    expect(roleMap).toContain('`NV01` | Web / Owner Cockpit Executor');
    expect(roleMap).toContain('`NV02` | Android Worker Executor');
    expect(roleMap).toContain('`NV03` | State / Data Executor');
    expect(roleMap).toContain('`NV04` | AI Coordination / Governance Policy Executor');
    expect(roleMap).toContain('`NV05` | Independent Reviewer');
    expect(roleMap).toContain('`NV06` | PC01 / Controller Executor');
  });

  it('forbids the observed NV05 undefined-role failure', () => {
    expect(roleMap).toContain('MUST NOT respond that NV05 has no defined role');
    expect(roleMap).toContain('audit the review-ready queue');
    expect(roleMap).toContain('begin review in the same response');
  });

  it('keeps startup queue authoritative and Trello-free', () => {
    expect(roleMap).toContain('Never use Trello');
    expect(roleMap).toContain('Audit GitHub authoritative queue/evidence');
    expect(roleMap).toContain('Only report `RẢNH` after a complete authoritative zero-work audit');
    expect(resumePolicy).toContain('Current registered identities are `NV00` through `NV06`');
  });
});
