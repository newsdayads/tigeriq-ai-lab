#!/usr/bin/env bash
# T04: launch the ACTUAL TigerIQ live-bridge in a disposable private netns.
# Caller creates namespace, enables only its own loopback, drops to runner,
# and strips inherited credentials with env -i.
set -Eeuo pipefail
umask 077
[[ "$(id -un)" == runner ]] || { echo T04_BRIDGE_OPERATOR_NOT_RUNNER >&2; exit 1; }
[[ "$#" -eq 1 ]] || { echo T04_BRIDGE_NODE_ARG_REQUIRED >&2; exit 1; }
node_bin="$1"
[[ "$node_bin" == /* && -x "$node_bin" ]] ||
  { echo T04_BRIDGE_NODE_UNVERIFIED >&2; exit 1; }
if env | grep -Eq '^(DATABASE_URL|GITHUB_TOKEN|TIGERIQ_GITHUB_TOKEN)='; then
  echo T04_BRIDGE_INHERITED_SECRET_OR_DB >&2; exit 1
fi
namespace="$(readlink /proc/self/ns/net)"
[[ "$namespace" =~ ^net:\[[0-9]+\]$ ]] ||
  { echo T04_BRIDGE_NAMESPACE_UNVERIFIED >&2; exit 1; }
export TIGERIQ_PSTACK_BRIDGE_MODE=read-only
export TIGERIQ_LIVE_BRIDGE_PORT=8801
export TIGERIQ_CORE_STATUS_URL=http://127.0.0.1:9/api/status
export TIGERIQ_CORE_EVENT_URL=http://127.0.0.1:9/api/github-event
export TIGERIQ_CODING_STATUS_URL=http://127.0.0.1:9/api/status
owned_dir="$(mktemp -d /tmp/tigeriq-pstack-bridge.XXXXXXXX)"
owned_inode="$(stat -c %i "$owned_dir")"
owned_uid="$(stat -c %u "$owned_dir")"
bridge_pid=
verified=0
cleanup() {
  local rc=$?
  trap - EXIT
  if [[ -n "$bridge_pid" ]]; then
    kill "$bridge_pid" 2>/dev/null || :
    wait "$bridge_pid" 2>/dev/null || :
    if kill -0 "$bridge_pid" 2>/dev/null; then
      echo T04_BRIDGE_PROCESS_NOT_STOPPED >&2
      rc=1
    fi
  fi
  if [[ "$owned_dir" =~ ^/tmp/tigeriq-pstack-bridge\.[A-Za-z0-9]+$ ]] &&
     [[ -d "$owned_dir" && ! -L "$owned_dir" ]] &&
     [[ "$(stat -c %u "$owned_dir")" == "$owned_uid" ]] &&
     [[ "$(stat -c %i "$owned_dir")" == "$owned_inode" ]]; then
    rm -rf --one-file-system -- "$owned_dir" || rc=1
  else
    echo T04_BRIDGE_CLEANUP_IDENTITY_INVALID >&2
    rc=1
  fi
  if [[ -e "$owned_dir" || -L "$owned_dir" ]]; then
    echo T04_BRIDGE_WORK_DIR_REMAINS >&2
    rc=1
  fi
  if [[ "$rc" -eq 0 && "$verified" -eq 1 ]]; then
    printf 'T04_REAL_BRIDGE_ISOLATED namespace=%s bridgePid=%s bridgeExited=true workDirRemoved=true actualSource=true githubRelayBlocked=true statusAuthoritative=false coreStarted=false fullStackAccepted=false\n' "$namespace" "$bridge_pid"
  else
    echo T04_BRIDGE_NATIVE_RUN_BLOCKED >&2
    rc=1
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
"$node_bin" apps/tigeriq-live-bridge/server.mjs >"$owned_dir/stdout.log" 2>"$owned_dir/stderr.log" &
bridge_pid=$!
ready=0
for attempt in $(seq 1 35); do
  if ! kill -0 "$bridge_pid" 2>/dev/null; then
    echo T04_BRIDGE_EXITED_BEFORE_READINESS >&2; exit 1
  fi
  if "$node_bin" -e 'fetch("http://127.0.0.1:8801/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 0.1
done
[[ "$ready" -eq 1 ]] || { echo T04_BRIDGE_HEALTH_TIMEOUT >&2; exit 1; }
actual_namespace="$(readlink "/proc/$bridge_pid/ns/net")"
[[ "$actual_namespace" == "$namespace" ]] ||
  { echo T04_BRIDGE_PROCESS_NAMESPACE_MISMATCH >&2; exit 1; }
# Actual HTTP from actual service: no mocked fetch or fixture payload.
"$node_bin" --input-type=module -e '
import assert from "node:assert/strict";
const base="http://127.0.0.1:8801";
const health=await fetch(base+"/health");
assert.equal(health.status,200);
const h=await health.json();
assert.equal(h.service,"tigeriq-live-status-bridge");
assert.equal(h.eventRelay,false);
assert.equal(h.sandboxReadOnly,true);
const status=await fetch(base+"/status");
assert.equal(status.status,200);
const s=await status.json();
assert.equal(s.ok,false);
assert.equal(s.authority,"PSTACK_SANDBOX_NONAUTHORITATIVE");
assert.equal(s.source.core,false);
assert.equal(s.source.coding,false);
const blocked=await fetch(base+"/github-event",{
 method:"POST",headers:{authorization:"Bearer test-only-not-secret",
 "x-github-event":"issues","x-tigeriq-delivery":"T04-test-no-relay"},
 body:"{}",signal:AbortSignal.timeout(3000)
});
assert.equal(blocked.status,405);
assert.equal((await blocked.json()).error,"PSTACK_BRIDGE_MUTATION_BLOCKED");
const write=await fetch(base+"/status",{method:"PUT"});
assert.equal(write.status,405);
assert.equal((await write.json()).error,"PSTACK_BRIDGE_MUTATION_BLOCKED");
console.log("T04_BRIDGE_HTTP_READBACK "+JSON.stringify({
 health200:true,status200:true,sourceCoreAvailable:false,
 sourceCodingAvailable:false,eventRelayBlocked:true,
 putBlocked:true,sourceNonAuthoritative:true
}));
'
verified=1
