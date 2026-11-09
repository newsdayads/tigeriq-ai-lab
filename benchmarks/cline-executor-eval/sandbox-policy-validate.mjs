// Design-only static invariants for #4532 M05. This does NOT enforce OS isolation.
export function reviewSandboxCandidate(p) {
  const errors = [];
  const check = (ok, code) => { if (!ok) errors.push(code); };
  const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (!obj(p)) return ['NOT_OBJECT'];
  const onlyKeys = (value, allowed) => obj(value) && Object.keys(value).every(k => allowed.includes(k));
  const schemas = [
    [p, ['schemaVersion','status','executionEnabled','approval','workOrder','executionScope','runtime','provider','network','workspaces','limits','rollback']],
    [p.approval, ['atomicWriterLeaseVerified','independentReviewPassed','osIsolationAttested','benchmarkActionAuthorized']],
    [p.runtime, ['userId','rootFilesystemReadOnly','privileged','noNewPrivileges','capabilities','hostPidNamespace','hostNetworkNamespace','hostIpcNamespace','groupId','supplementaryGroupIds','userNamespaceIsolationRequired','mountNamespaceIsolationRequired','hostDevices','seccomp','readHostPaths','writeHostPaths','credentialInjection','hostSocketMounts']],
    [p.provider, ['name','kind','modelDigest','access']],
    [p.network, ['namespaceIsolationRequired','defaultDeny','dnsExternal','externalEgress','directHostNetwork','allowedDestinationKinds','relayAddress','enforcement']],
    [p.limits, ['wallSeconds','cpuCores','memoryMiB','pids','workspaceMiBEach','outputBytes','fileBytes','maxFixtureEntries','maxFixtureDepth','paidCostUsd']],
    [p.rollback, ['destroyEphemeralWorkspace','revokeRelayOnExit','terminateProcessGroup','preserveReceiptsOutsideAgentWriteScope','retryRequiresNewLease']]
  ];
  if (Array.isArray(p.workspaces)) for (const item of p.workspaces)
    schemas.push([item,['name','mountPoint','ephemeral','shared','writeScope']]);
  check(schemas.every(([x, allowed]) => onlyKeys(x, allowed)), 'UNRECOGNIZED_POLICY_KEYS');
  check(p.schemaVersion === 1, 'SCHEMA_VERSION');
  check(p.status === 'DESIGN_ONLY_NOT_DEPLOYABLE' && p.executionEnabled === false, 'NOT_DEPLOYABLE');
  check(p.workOrder === 4532 && p.executionScope === 'TIGERIQ_CLINE_NV02_SOURCE_AND_EVAL_V1', 'WORK_ORDER_SCOPE');
  const a = p.approval || {};
  check(['atomicWriterLeaseVerified','independentReviewPassed','osIsolationAttested','benchmarkActionAuthorized'].every(k => a[k] === false), 'NO_FAKE_APPROVAL');
  const r = p.runtime || {};
  check(r.userId === 10001 && r.groupId === 10001 && r.rootFilesystemReadOnly === true, 'NON_ROOT_READ_ONLY');
  check(Array.isArray(r.supplementaryGroupIds) && r.supplementaryGroupIds.length === 0, 'NO_SUPPLEMENTARY_GROUPS');
  check(r.privileged === false && r.noNewPrivileges === true && Array.isArray(r.capabilities) && r.capabilities.length === 0, 'NO_PRIVILEGE_ESCALATION');
  check(r.hostPidNamespace === false && r.hostNetworkNamespace === false && r.hostIpcNamespace === false, 'NO_HOST_NAMESPACES');
  check(r.userNamespaceIsolationRequired === true && r.mountNamespaceIsolationRequired === true, 'USER_MOUNT_NAMESPACE_ISOLATION');
  check(Array.isArray(r.hostDevices) && r.hostDevices.length === 0 && Array.isArray(r.hostSocketMounts) && r.hostSocketMounts.length === 0, 'NO_HOST_DEVICES_SOCKETS');
  check(Array.isArray(r.readHostPaths) && r.readHostPaths.length === 0 && Array.isArray(r.writeHostPaths) && r.writeHostPaths.length === 0 && r.credentialInjection === false, 'NO_HOST_PATHS_CREDENTIALS');
  check(r.seccomp === 'REQUIRED_ATTESTED_PROFILE_NOT_SELECTED', 'SECCOMP_REVIEW_REQUIRED');
  const n = p.network || {};
  check(n.namespaceIsolationRequired === true && n.defaultDeny === true && n.dnsExternal === false && n.externalEgress === false && n.directHostNetwork === false, 'NETWORK_DENY');
  check(Array.isArray(n.allowedDestinationKinds) && n.allowedDestinationKinds.length === 1 && n.allowedDestinationKinds[0] === 'ATTESTED_LOCAL_OLLAMA_RELAY' && n.relayAddress === 'UNRESOLVED_DO_NOT_CONNECT' && n.enforcement === 'REQUIRES_OS_AND_FIREWALL_ATTESTATION', 'LOCAL_RELAY_UNRESOLVED');
  const m = p.provider || {};
  check(m.name === 'ollama' && m.kind === 'LOCAL_ONLY' && m.modelDigest === 'UNRESOLVED_PIN_REQUIRED_BEFORE_RUN' && m.access === 'ATTESTED_RELAY_ONLY_NO_DIRECT_HOST_NETWORK', 'PINNED_LOCAL_OLLAMA_ONLY');
  const w = p.workspaces;
  check(Array.isArray(w) && w.length === 2 && w[0]?.name === 'cline' && w[1]?.name === 'nv09' && w[0]?.mountPoint === '/workspaces/cline' && w[1]?.mountPoint === '/workspaces/nv09' && w.every(x => obj(x) && x.ephemeral === true && x.shared === false && x.writeScope === 'OWN_WORKSPACE_ONLY'), 'TWO_ISOLATED_WORKSPACES');
  const lim = p.limits || {};
  check(Number.isInteger(lim.wallSeconds) && lim.wallSeconds > 0 && lim.wallSeconds <= 180 && Number.isInteger(lim.cpuCores) && lim.cpuCores > 0 && lim.cpuCores <= 2 && Number.isInteger(lim.memoryMiB) && lim.memoryMiB >= 128 && lim.memoryMiB <= 2048 && Number.isInteger(lim.pids) && lim.pids >= 1 && lim.pids <= 64, 'BOUNDED_COMPUTE');
  check(Number.isInteger(lim.workspaceMiBEach) && lim.workspaceMiBEach > 0 && lim.workspaceMiBEach <= 128 && Number.isInteger(lim.outputBytes) && lim.outputBytes > 0 && lim.outputBytes <= 1048576 && Number.isInteger(lim.fileBytes) && lim.fileBytes > 0 && lim.fileBytes <= 1048576, 'BOUNDED_STORAGE_OUTPUT');
  check(Number.isInteger(lim.maxFixtureEntries) && lim.maxFixtureEntries >= 1 && lim.maxFixtureEntries <= 256 && Number.isInteger(lim.maxFixtureDepth) && lim.maxFixtureDepth >= 1 && lim.maxFixtureDepth <= 24 && lim.paidCostUsd === 0, 'BOUNDED_TREE_COST');
  const b = p.rollback || {};
  check(['destroyEphemeralWorkspace','revokeRelayOnExit','terminateProcessGroup','preserveReceiptsOutsideAgentWriteScope','retryRequiresNewLease'].every(k => b[k] === true), 'ROLLBACK_AND_RECEIPTS');
  return errors;
}