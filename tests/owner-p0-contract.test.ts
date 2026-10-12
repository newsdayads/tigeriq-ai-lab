import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Canonical-source regression assertions; runtime acceptance still requires a live canary.
const load = (file: string) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const constitution = load('bootstrap/01_TIGERIQ_COMPANY_CONSTITUTION.md');
const workflow = load('bootstrap/02_TIGERIQ_WORKFLOW.md');
const workforce = load('bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md');
const baseline = load('bootstrap/05_TIGERIQ_BASELINE_DECISIONS.md');
const core = load('apps/tigeriq-core/core.mjs');

describe('P0 Owner authority: canonical policy and Core hard guards', () => {
  it('ranks explicit Owner instructions above internal policy and reserves P0 to Owner/Vy', () => {
    expect(constitution).toContain('1. Explicit current Owner instruction.');
    expect(constitution).toContain('P0_OWNER_VY_EXCLUSIVE=true');
    expect(constitution).toContain('OWNER_DIRECT_COMMAND_IS_AUTHORIZATION=true');
    expect(constitution).toContain('ONE_SCOPE_ONE_WRITER=true');
  });

  it('does not require secondary AI approval but preserves real technical gates and truthful evidence', () => {
    expect(constitution).toContain('REVIEW_IS_TECHNICAL_EVIDENCE_NOT_OWNER_PERMISSION=true');
    expect(constitution).toContain('AUTHORIZATION_SCOPE_BOUNDARY=true');
    expect(workflow).toContain('AI_QUEUE_REVIEW_CANNOT_VETO_OWNER=true');
    expect(workflow).toContain('REVIEW_IS_NOT_OWNER_APPROVAL=true');
    expect(workflow).toContain('REAL_HARD_GATES=PAID_FINANCIAL|CREDENTIAL_SECRET|SECURITY_PERMISSION_BOUNDARY|DESTRUCTIVE_IRREVERSIBLE|PHYSICAL_LEGAL');
    expect(workflow).toContain('OWNER_WAIVER');
    expect(workflow).toContain('không khai `REVIEW_PASS`');
  });

  it('inherits the hard lock in workforce rules and stable baseline without escalating Codex or remote controls', () => {
    expect(workforce).toContain('P0_OWNER_VY_EXCLUSIVE=true');
    expect(workforce).toContain('OWNER_DIRECT_COMMAND_IS_AUTHORIZATION=true');
    expect(workforce).toContain('REVIEW_IS_NOT_OWNER_APPROVAL=true');
    expect(baseline).toContain('P0 chỉ do anh Sơn và Vy điều hành trực tiếp');
    expect(workflow).toContain('Codex chỉ khi anh nêu rõ tên Codex và phạm vi');
    expect(workflow).toContain('Cổng điều khiển máy tính từ xa chỉ mở theo từng lệnh');
  });

  it('never autonomously claims a P0 objective from the database queue', () => {
    const start = core.indexOf('async function claimJob()');
    const end = core.indexOf('async function emitSkillEffectivenessObservations', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const claim = core.slice(start, end);
    expect(claim).toContain("and o.status='active' and o.priority<>'P0'");
    expect(claim).toContain('for update skip locked limit 1');
  });

  it('denies generic HTTP creation of P0 before inserting an autonomous objective', () => {
    const start = core.indexOf("if(req.method==='POST'&&url.pathname==='/api/objectives')");
    const end = core.indexOf("res.writeHead(404);res.end('not_found');", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const api = core.slice(start, end);
    expect(api).toContain("String(b.priority||'').trim().toUpperCase()==='P0'");
    expect(api).toContain('res.writeHead(403');
    expect(api).toContain("error:'P0_OWNER_VY_DIRECT_ONLY'");
    expect(api.indexOf("error:'P0_OWNER_VY_DIRECT_ONLY'")).toBeLessThan(api.indexOf("insert into tigeriq_objectives"));
    expect(api).toContain("['P1','P2'].includes(b.priority)?b.priority:'P1'");
  });
});
