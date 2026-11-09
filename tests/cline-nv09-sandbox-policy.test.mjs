import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {reviewSandboxCandidate} from '../benchmarks/cline-executor-eval/sandbox-policy-validate.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(await readFile(path.join(here,'../benchmarks/cline-executor-eval/sandbox-policy.candidate.json'), 'utf8'));
const clone = () => structuredClone(policy);

test('M05 design-only candidate passes static review; execution stays disabled',()=>{
  assert.deepEqual(reviewSandboxCandidate(policy),[]);
  assert.equal(policy.executionEnabled,false);
  assert.equal(policy.approval.osIsolationAttested,false);
});
const reject = (title,field,mutate) => test(title,()=>{
  const x = clone(); mutate(x);
  const errors=reviewSandboxCandidate(x);
  assert.ok(errors.includes(field),`${field} must reject mutation, got ${JSON.stringify(errors)}`);
});
reject('reject privileged runtime','NO_PRIVILEGE_ESCALATION',x=>{x.runtime.privileged=true});
reject('reject root UID','NON_ROOT_READ_ONLY',x=>{x.runtime.userId=0});
reject('reject writable root filesystem','NON_ROOT_READ_ONLY',x=>{x.runtime.rootFilesystemReadOnly=false});
reject('reject host network','NO_HOST_NAMESPACES',x=>{x.runtime.hostNetworkNamespace=true});
reject('reject host bind mount','NO_HOST_PATHS_CREDENTIALS',x=>{x.runtime.readHostPaths.push('/home/owner/.ssh')});
reject('reject host socket','NO_HOST_DEVICES_SOCKETS',x=>{x.runtime.hostSocketMounts.push('/var/run/docker.sock')});
reject('reject injected secret','NO_HOST_PATHS_CREDENTIALS',x=>{x.runtime.credentialInjection=true});
reject('reject default-allow egress','NETWORK_DENY',x=>{x.network.defaultDeny=false});
reject('reject direct host networking','NETWORK_DENY',x=>{x.network.directHostNetwork=true});
reject('reject external DNS','NETWORK_DENY',x=>{x.network.dnsExternal=true});
reject('reject second egress destination','LOCAL_RELAY_UNRESOLVED',x=>{x.network.allowedDestinationKinds.push('INTERNET')});
reject('reject non-local provider','PINNED_LOCAL_OLLAMA_ONLY',x=>{x.provider.name='cloud-provider'});
reject('reject fake ready relay','LOCAL_RELAY_UNRESOLVED',x=>{x.network.relayAddress='http://127.0.0.1:11434'});
reject('reject shared agent workspace','TWO_ISOLATED_WORKSPACES',x=>{x.workspaces[0].shared=true});
reject('reject same mount for two agents','TWO_ISOLATED_WORKSPACES',x=>{x.workspaces[1].mountPoint=x.workspaces[0].mountPoint});
reject('reject memory excess','BOUNDED_COMPUTE',x=>{x.limits.memoryMiB=4096});
reject('reject unbounded wall time','BOUNDED_COMPUTE',x=>{x.limits.wallSeconds=3600});
reject('reject excessive output','BOUNDED_STORAGE_OUTPUT',x=>{x.limits.outputBytes=20000000});
reject('reject excessive tree entries','BOUNDED_TREE_COST',x=>{x.limits.maxFixtureEntries=9000});
reject('reject paid action','BOUNDED_TREE_COST',x=>{x.limits.paidCostUsd=1});
reject('reject rollback disabled','ROLLBACK_AND_RECEIPTS',x=>{x.rollback.destroyEphemeralWorkspace=false});
reject('reject receipt writable by agent','ROLLBACK_AND_RECEIPTS',x=>{x.rollback.preserveReceiptsOutsideAgentWriteScope=false});
reject('reject unverified approvals marked passed','NO_FAKE_APPROVAL',x=>{x.approval.osIsolationAttested=true});
reject('reject enabling an unattested sandbox','NOT_DEPLOYABLE',x=>{x.executionEnabled=true});
reject('reject missing seccomp review','SECCOMP_REVIEW_REQUIRED',x=>{x.runtime.seccomp='unconfined'});
reject('fail closed for null workspace schema','TWO_ISOLATED_WORKSPACES',x=>{x.workspaces[0]=null});
reject('reject string cpu limit','BOUNDED_COMPUTE',x=>{x.limits.cpuCores='2'});
reject('reject unreviewed host-volume override field','UNRECOGNIZED_POLICY_KEYS',x=>{x.runtime.extraMounts=['/home/owner']});
reject('reject unknown permissive top-level toggle','UNRECOGNIZED_POLICY_KEYS',x=>{x.allowInternet=true});

// Regression: M05 design text requires OS user+mount namespaces but V1 JSON
// did not represent these controls. The static validator must fail closed.
test('M05 explicitly requires user and mount namespace isolation',()=>{
  assert.equal(policy.runtime.userNamespaceIsolationRequired, true);
  assert.equal(policy.runtime.mountNamespaceIsolationRequired, true);
});
reject('reject missing user namespace isolation','USER_MOUNT_NAMESPACE_ISOLATION',x=>{x.runtime.userNamespaceIsolationRequired=false});
reject('reject missing mount namespace isolation','USER_MOUNT_NAMESPACE_ISOLATION',x=>{x.runtime.mountNamespaceIsolationRequired=false});
reject('reject string namespace isolation flag','USER_MOUNT_NAMESPACE_ISOLATION',x=>{x.runtime.userNamespaceIsolationRequired='true'});

// V3 design-intent regression: the documented fixed low-privilege identity
// must be unambiguous. Both Unix UID and primary GID are pinned; no groups.
test('M05 explicitly pins numeric UID and GID 10001 with no supplementary groups',()=>{
  assert.equal(policy.runtime.userId,10001);
  assert.equal(policy.runtime.groupId,10001);
  assert.deepEqual(policy.runtime.supplementaryGroupIds,[]);
});
reject('reject alternative non-root UID','NON_ROOT_READ_ONLY',x=>{x.runtime.userId=10002});
reject('reject low-privilege-claim UID 1','NON_ROOT_READ_ONLY',x=>{x.runtime.userId=1});
reject('reject root GID zero','NON_ROOT_READ_ONLY',x=>{x.runtime.groupId=0});
reject('reject alternative GID','NON_ROOT_READ_ONLY',x=>{x.runtime.groupId=10002});
reject('reject group ID represented as string','NON_ROOT_READ_ONLY',x=>{x.runtime.groupId='10001'});
reject('reject supplementary root group','NO_SUPPLEMENTARY_GROUPS',x=>{x.runtime.supplementaryGroupIds=[0]});
reject('reject non-array supplementary groups','NO_SUPPLEMENTARY_GROUPS',x=>{x.runtime.supplementaryGroupIds='none'});