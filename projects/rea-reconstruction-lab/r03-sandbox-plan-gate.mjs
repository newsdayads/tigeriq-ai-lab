/**
 * REA R03 design-only sandbox plan validator, not an OS sandbox.
 * Side-effect-free. It never installs, runs or authorizes REA.
 * Results deliberately contain only fixed field identifiers, not input values.
 */
const sourceCommit = 'a56f7bb668ab23fec8d33f7af353ac7ed2fe1895';
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const localRef = v => typeof v === 'string' && /^LOCAL_ONLY:[A-Za-z0-9._-]{3,64}$/.test(v);
const bounded = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * Validate only the declared architectural *plan*; all real host, network,
 * lease, device, license and process isolation still require separate receipts.
 */
export function inspectR03SandboxPlan(input) {
  const failures = [];
  const fail = (field, code) => failures.push(field + ':' + code);
  const record = (value, label, allowed) => {
    if (!isRecord(value)) { fail(label, 'OBJECT_REQUIRED'); return false; }
    if (Object.keys(value).some(k => !allowed.includes(k))) fail(label, 'UNEXPECTED_FIELD');
    return true;
  };
  if (!record(input, 'root',
    ['schema', 'source', 'isolation', 'network', 'mounts', 'limits', 'tools', 'sample', 'audit', 'gate']))
    return { decision: 'DESIGN_REJECTED', execution_authorized: false, host_verified: false, failures };

  if (input.schema !== 'rea-r03-v1') fail('schema', 'VERSION_MISMATCH');

  if (record(input.source, 'source', ['package', 'version', 'commit', 'lockIntegrityVerified'])) {
    if (input.source.package !== 'rea-agents') fail('source.package', 'PIN_REQUIRED');
    if (input.source.version !== '6.4.0') fail('source.version', 'PIN_REQUIRED');
    if (input.source.commit !== sourceCommit) fail('source.commit', 'PIN_REQUIRED');
    if (input.source.lockIntegrityVerified !== false)
      fail('source.lockIntegrityVerified', 'MUST_REMAIN_UNVERIFIED_UNTIL_HOST_PROOF');
  }

  if (record(input.isolation, 'isolation', ['placement', 'disposable', 'nonAdmin', 'noHostUserMapping', 'noHostServiceLink'])) {
    if (input.isolation.placement !== 'OFF_HOST_DISPOSABLE_VM') fail('isolation.placement', 'OFF_HOST_VM_REQUIRED');
    for (const k of ['disposable', 'nonAdmin', 'noHostUserMapping', 'noHostServiceLink'])
      if (input.isolation[k] !== true) fail('isolation.' + k, 'TRUE_REQUIRED');
  }

  if (record(input.network, 'network', ['ingress', 'egress', 'dns', 'proxy'])) {
    if (input.network.ingress !== 'DENY_ALL') fail('network.ingress', 'DENY_ALL_REQUIRED');
    if (input.network.egress !== 'DENY_ALL') fail('network.egress', 'DENY_ALL_REQUIRED');
    if (input.network.dns !== 'DISABLED') fail('network.dns', 'DISABLED_REQUIRED');
    if (input.network.proxy !== 'NONE') fail('network.proxy', 'NONE_REQUIRED');
  }

  if (record(input.mounts, 'mounts', ['hostHome', 'hostSecrets', 'hostDevices', 'hostServices', 'inputReadOnly', 'outputEphemeral'])) {
    for (const k of ['hostHome', 'hostSecrets', 'hostDevices', 'hostServices'])
      if (input.mounts[k] !== false) fail('mounts.' + k, 'FALSE_REQUIRED');
    for (const k of ['inputReadOnly', 'outputEphemeral'])
      if (input.mounts[k] !== true) fail('mounts.' + k, 'TRUE_REQUIRED');
  }

  if (record(input.limits, 'limits', ['vcpus', 'memoryMiB', 'diskMiB', 'processes', 'wallSeconds'])) {
    for (const [key, low, high] of [
      ['vcpus', 1, 2], ['memoryMiB', 256, 2048], ['diskMiB', 256, 4096],
      ['processes', 1, 64], ['wallSeconds', 1, 600]
    ]) if (!bounded(input.limits[key], low, high)) fail('limits.' + key, 'BOUNDED_INTEGER_REQUIRED');
  }

  if (record(input.tools, 'tools', ['allowlist', 'setup', 'update', 'browser', 'adb', 'externalProviders', 'privilegedHelpers'])) {
    if (!Array.isArray(input.tools.allowlist) || input.tools.allowlist.length !== 0)
      fail('tools.allowlist', 'EMPTY_UNTIL_SEPARATE_R07_GATE');
    for (const k of ['setup', 'update', 'browser', 'adb', 'externalProviders', 'privilegedHelpers'])
      if (input.tools[k] !== false) fail('tools.' + k, 'FALSE_REQUIRED');
  }

  if (record(input.sample, 'sample', ['kind', 'permissionChecked', 'reference'])) {
    if (input.sample.kind !== 'JQ_1_7_SYNTHETIC_ONLY') fail('sample.kind', 'AUTHORIZED_SYNTHETIC_ONLY');
    if (input.sample.permissionChecked !== true) fail('sample.permissionChecked', 'TRUE_REQUIRED');
    if (!localRef(input.sample.reference)) fail('sample.reference', 'LOCAL_POINTER_REQUIRED');
  }

  if (record(input.audit, 'audit', ['redacted', 'noRawInputUpload', 'ephemeral', 'noCredentialsInLogs'])) {
    for (const k of ['redacted', 'noRawInputUpload', 'ephemeral', 'noCredentialsInLogs'])
      if (input.audit[k] !== true) fail('audit.' + k, 'TRUE_REQUIRED');
  }

  if (record(input.gate, 'gate', ['phase', 'hostInstallApproved', 'coreLeaseClaimed', 'pc01Mutation'])) {
    if (input.gate.phase !== 'R03_DESIGN_ONLY') fail('gate.phase', 'DESIGN_ONLY_REQUIRED');
    for (const k of ['hostInstallApproved', 'coreLeaseClaimed', 'pc01Mutation'])
      if (input.gate[k] !== false) fail('gate.' + k, 'FALSE_REQUIRED');
  }

  return {
    decision: failures.length === 0 ? 'DESIGN_CANDIDATE_ONLY' : 'DESIGN_REJECTED',
    execution_authorized: false,
    host_verified: false,
    failures
  };
}
