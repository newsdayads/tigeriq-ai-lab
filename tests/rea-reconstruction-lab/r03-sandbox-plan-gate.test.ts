import { expect, it } from 'vitest';
// @ts-ignore Dedicated side-effect-free JS design gate intentionally has no declaration file.
import { inspectR03SandboxPlan } from '../../projects/rea-reconstruction-lab/r03-sandbox-plan-gate.mjs';

const sample = () => ({
  schema: 'rea-r03-v1',
  source: {
    package: 'rea-agents', version: '6.4.0',
    commit: 'a56f7bb668ab23fec8d33f7af353ac7ed2fe1895',
    lockIntegrityVerified: false
  },
  isolation: {
    placement: 'OFF_HOST_DISPOSABLE_VM', disposable: true, nonAdmin: true,
    noHostUserMapping: true, noHostServiceLink: true
  },
  network: { ingress: 'DENY_ALL', egress: 'DENY_ALL', dns: 'DISABLED', proxy: 'NONE' },
  mounts: {
    hostHome: false, hostSecrets: false, hostDevices: false,
    hostServices: false, inputReadOnly: true, outputEphemeral: true
  },
  limits: { vcpus: 2, memoryMiB: 1024, diskMiB: 2048, processes: 32, wallSeconds: 300 },
  tools: {
    allowlist: [], setup: false, update: false, browser: false,
    adb: false, externalProviders: false, privilegedHelpers: false
  },
  sample: {
    kind: 'JQ_1_7_SYNTHETIC_ONLY', permissionChecked: true,
    reference: 'LOCAL_ONLY:jq17-fixture-01'
  },
  audit: {
    redacted: true, noRawInputUpload: true, ephemeral: true, noCredentialsInLogs: true
  },
  gate: {
    phase: 'R03_DESIGN_ONLY', hostInstallApproved: false,
    coreLeaseClaimed: false, pc01Mutation: false
  }
});
const reject = (change: (data: any) => void, field: string) => {
  const plan: any = sample();
  change(plan);
  const result = inspectR03SandboxPlan(plan);
  expect(result.decision).toBe('DESIGN_REJECTED');
  expect(result.execution_authorized).toBe(false);
  expect(result.host_verified).toBe(false);
  expect(result.failures.some((x: string) => x.startsWith(field + ':'))).toBe(true);
};

it('safe design fixture remains only a candidate, never host approved', () => {
  expect(inspectR03SandboxPlan(sample())).toEqual({
    decision: 'DESIGN_CANDIDATE_ONLY',
    execution_authorized: false, host_verified: false, failures: []
  });
});
it('empty input is rejected fail-closed', () => {
  const r = inspectR03SandboxPlan(null);
  expect(r.decision).toBe('DESIGN_REJECTED');
  expect(r.execution_authorized).toBe(false);
});
it('never allows installation on host PC01', () =>
  reject(x => { x.isolation.placement = 'PC01_HOST'; }, 'isolation.placement'));
it('requires unprivileged identity', () =>
  reject(x => { x.isolation.nonAdmin = false; }, 'isolation.nonAdmin'));
it('requires disposable off-host environment', () =>
  reject(x => { x.isolation.disposable = false; }, 'isolation.disposable'));
it('denies network egress', () =>
  reject(x => { x.network.egress = 'ALLOW_ALL'; }, 'network.egress'));
it('denies DNS leakage and proxy', () =>
  reject(x => { x.network.dns = 'ENABLED'; x.network.proxy = 'SYSTEM'; }, 'network.dns'));
it('rejects host home mounts', () =>
  reject(x => { x.mounts.hostHome = true; }, 'mounts.hostHome'));
it('rejects secret and host service mounts', () =>
  reject(x => { x.mounts.hostSecrets = true; x.mounts.hostServices = true; }, 'mounts.hostSecrets'));
it('rejects host device passthrough', () =>
  reject(x => { x.mounts.hostDevices = true; }, 'mounts.hostDevices'));
it('requires bounded memory and process limits', () =>
  reject(x => { x.limits.memoryMiB = 65536; x.limits.processes = 1000; }, 'limits.memoryMiB'));
it('rejects setup and update side effects', () =>
  reject(x => { x.tools.setup = true; x.tools.update = true; }, 'tools.setup'));
it('rejects browsers and external providers in the initial architecture', () =>
  reject(x => { x.tools.browser = true; x.tools.externalProviders = true; }, 'tools.browser'));
it('fails closed for any preallowed REA tool until R07 authorization', () =>
  reject(x => { x.tools.allowlist = ['browser_open']; }, 'tools.allowlist'));
it('rejects a claim that source lock integrity has already been attested', () =>
  reject(x => { x.source.lockIntegrityVerified = true; }, 'source.lockIntegrityVerified'));
it('rejects unapproved private samples', () =>
  reject(x => { x.sample.kind = 'PRODUCTION_SECRET'; }, 'sample.kind'));
it('rejects public reference in evidence fields', () =>
  reject(x => { x.sample.reference = 'https://example.com/private'; }, 'sample.reference'));
it('requires audit redaction', () =>
  reject(x => { x.audit.redacted = false; }, 'audit.redacted'));
it('rejects self-granted host installation authorization or Core lease', () =>
  reject(x => { x.gate.hostInstallApproved = true; x.gate.coreLeaseClaimed = true; }, 'gate.hostInstallApproved'));
it('rejects mismatched package commit', () =>
  reject(x => { x.source.commit = '0'.repeat(40); }, 'source.commit'));
it('keeps unexpected private keys out of error results', () => {
  const data: any = sample();
  data.SECRET_REAL_CREDENTIAL_987654 = 'SENSITIVE_VALUE_XYZ';
  const r = inspectR03SandboxPlan(data);
  expect(r.failures).toContain('root:UNEXPECTED_FIELD');
  expect(JSON.stringify(r)).not.toContain('SECRET_REAL_CREDENTIAL_987654');
  expect(JSON.stringify(r)).not.toContain('SENSITIVE_VALUE_XYZ');
});
it('rejects a missing or malformed section without throwing', () =>
  reject(x => { x.network = null; }, 'network'));
