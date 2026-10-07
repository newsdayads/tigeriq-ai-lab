import { describe, expect, it } from 'vitest';
import { explicitAutoExecutionExclusion, p1P5StandingReleaseAuthorized, parsePcOperatorDirectAction, safeAutoWorkAdmission } from '../apps/tigeriq-core/github-intake.mjs';

const releaseBody = [
  'PRIORITY=P1',
  'CAPABILITY=pc_operator',
  'CURRENT_STATE=WAIT_PRODUCTION_RELEASE_GATE',
  'TIGERIQ_EXECUTABLE=false',
  'AUTO_QUEUE=EXCLUDED_HARD_GATE',
  'RESOURCE_SCOPE=TIGERIQ_LIVE_RELEASE_TEST',
  'MUTATION_OWNER=CORE_DYNAMIC_LEASE',
  'NO_PAID_COST=true',
  'NO_CREDENTIAL_CHANGE=true',
  'NO_SECURITY_BOUNDARY_CHANGE=true',
  'NO_DESTRUCTIVE=true',
  'VERCEL_RELEASE_REASON=Publish verified P1 LIVE outcome',
  'PC_OPERATOR_DIRECT_ACTION_JSON={"action":"tigeriq_live_3150_production_deploy","expectedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","artifactSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}',
].join('\n');

describe('P1-P5 outcome-to-LIVE policy #4425', () => {
  it('treats a P1 release step as standing-authorized without OWNER_DIRECT', () => {
    expect(p1P5StandingReleaseAuthorized(releaseBody)).toBe(true);
    expect(explicitAutoExecutionExclusion(releaseBody)).toBe('');
    const parsed = parsePcOperatorDirectAction(releaseBody, false);
    expect(parsed.valid).toBe(true);
    expect(parsed.action).toMatchObject({
      action: 'tigeriq_live_3150_production_deploy',
      ownerAuthorized: true,
      expectedSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      artifactSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
  });

  it('admits the bounded direct release while preserving other hard gates', () => {
    const admission = safeAutoWorkAdmission({
      number: 9001,
      state: 'open',
      title: '[P1][LIVE] release test',
      body: releaseBody,
      labels: [],
    });
    expect(admission.eligible).toBe(true);
  });

  it.each([
    'BLOCKER=CREDENTIAL_HANDOFF_REQUIRED',
    'HARD_GATE_STATUS=PAID_FINANCIAL',
    'OWNER_GATE_REASON=SECURITY_PERMISSION_BOUNDARY',
    'CURRENT_GATE=DESTRUCTIVE_IRREVERSIBLE',
  ])('does not standing-authorize a real Owner gate: %s', (gate) => {
    const body = releaseBody + '\n' + gate;
    expect(p1P5StandingReleaseAuthorized(body)).toBe(false);
    expect(parsePcOperatorDirectAction(body, false).valid).toBe(false);
  });

  it('never applies standing release authority to P0', () => {
    const body = releaseBody.replace('PRIORITY=P1', 'PRIORITY=P0');
    expect(p1P5StandingReleaseAuthorized(body)).toBe(false);
    expect(parsePcOperatorDirectAction(body, false).valid).toBe(false);
  });

  it('keeps App Chrome excluded even when a P1 direct action is present', () => {
    const admission = safeAutoWorkAdmission({
      number: 9002,
      state: 'open',
      title: '[P1][APP-CHROME] forbidden',
      body: releaseBody,
      labels: [],
    });
    expect(admission.eligible).toBe(false);
    expect(admission.reason).toBe('APP_CHROME_EXCLUDED');
  });
});
