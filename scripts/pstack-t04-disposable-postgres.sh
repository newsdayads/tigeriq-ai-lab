#!/usr/bin/env bash
# T04 native disposable PostgreSQL subproof, never full-stack acceptance.
# Invoked only on a public-repo GitHub-hosted Ubuntu CI runner in a private
# network namespace as unprivileged "runner". No production data or secrets.
set -Eeuo pipefail
umask 077
[[ "$(id -un)" == runner ]] || { echo T04_POSTGRES_WRONG_USER >&2; exit 1; }
[[ -e /proc/self/ns/net ]] || { echo T04_POSTGRES_NETNS_MISSING >&2; exit 1; }
command -v pg_config >/dev/null || { echo T04_POSTGRES_BINDIR_MISSING >&2; exit 1; }
bin="$(pg_config --bindir)"
for exe in initdb pg_ctl createdb dropdb psql; do
  [[ -x "$bin/$exe" ]] || { echo "T04_POSTGRES_BINARY_MISSING:$exe" >&2; exit 1; }
done
base="$(mktemp -d /tmp/tigeriq-pstack-pg.XXXXXXXX)"
data="$base/cluster"
sock="$base/socket"
log="$base/postgres.log"
mkdir -m 0700 "$sock"
base_owner="$(stat -c %u "$base")"
base_inode="$(stat -c %i "$base")"
started=0
verified=0
core_denied=0
cleanup() {
  local rc=$?
  trap - EXIT
  if [[ "$started" == 1 ]]; then
    if "$bin/pg_ctl" -D "$data" -m immediate -w stop >/dev/null 2>&1; then
      started=0
    else
      echo T04_POSTGRES_CLEANUP_STOP_FAILED >&2
      rc=1
    fi
  fi
  # FAIL CLOSED: never remove on a failed stop, or while the cluster is
  # observed running. Failed runs leave evidence on the ephemeral runner.
  if [[ -d "$data" ]] && "$bin/pg_ctl" -D "$data" status >/dev/null 2>&1; then
    echo T04_POSTGRES_CLEANUP_PROCESS_STILL_RUNNING >&2
    rc=1
  fi
  if [[ "$rc" -ne 0 ]]; then
    echo T04_POSTGRES_DISPOSABLE_BLOCKED >&2
    exit "$rc"
  fi
  if [[ "$base" =~ ^/tmp/tigeriq-pstack-pg\.[A-Za-z0-9]+$ ]] &&
     [[ -d "$base" && ! -L "$base" ]] &&
     [[ "$(stat -c %u "$base")" == "$base_owner" ]] &&
     [[ "$(stat -c %i "$base")" == "$base_inode" ]]; then
    rm -rf --one-file-system -- "$base" || rc=1
  else
    echo T04_POSTGRES_CLEANUP_IDENTITY_UNVERIFIED >&2
    rc=1
  fi
  if [[ -e "$base" || -L "$base" ]]; then
    echo T04_POSTGRES_CLUSTER_DIR_NOT_REMOVED >&2
    rc=1
  fi
  if [[ "$rc" == 0 && "$verified" == 1 && "$core_denied" == 1 ]]; then
    printf 'T04_POSTGRES_DISPOSABLE_REAL namespace=%s systemId=%s database=%s dbDropped=true postgresStopped=true privateSocket=true clusterDirectoryRemoved=true coreDeniedBeforeDb=true fullStackAccepted=false\n' "$ns" "$system_id" "$db"
  else
    echo T04_POSTGRES_DISPOSABLE_BLOCKED >&2
    rc=1
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP
"$bin/initdb" -D "$data" -U runner --auth-local=trust --auth-host=reject --no-instructions >/dev/null
"$bin/pg_ctl" -D "$data" -l "$log" -w -o "-c listen_addresses= -c unix_socket_directories=$sock -c port=55433" start >/dev/null
started=1
ns="$(readlink /proc/self/ns/net)"
[[ "$ns" =~ ^net:\[[0-9]+\]$ ]] || { echo T04_POSTGRES_NAMESPACE_INVALID >&2; exit 1; }
actual_data="$("$bin/psql" -X -qAt -v ON_ERROR_STOP=1 -h "$sock" -p 55433 -U runner -d postgres -c "select current_setting('data_directory');")"
[[ "$actual_data" == "$data" ]] || { echo T04_POSTGRES_DATA_FINGERPRINT_MISMATCH >&2; exit 1; }
system_id="$("$bin/psql" -X -qAt -v ON_ERROR_STOP=1 -h "$sock" -p 55433 -U runner -d postgres -c 'select system_identifier from pg_control_system();')"
[[ "$system_id" =~ ^[0-9]{15,22}$ ]] || { echo T04_POSTGRES_SYSTEM_ID_INVALID >&2; exit 1; }
db="tigeriq_pstack_$$"
"$bin/createdb" -h "$sock" -p 55433 -U runner "$db"
seen="$("$bin/psql" -X -qAt -v ON_ERROR_STOP=1 -h "$sock" -p 55433 -U runner -d "$db" -c 'select current_database();')"
[[ "$seen" == "$db" ]] || { echo T04_POSTGRES_DB_READBACK_MISMATCH >&2; exit 1; }
# Core negative test: a genuine isolated DB exists in this same namespace,
# but sandbox guard MUST reject Core before any DB access or schema mutation.
node_bin="$1"
[[ "$node_bin" == /* && -x "$node_bin" ]] ||
  { echo T04_POSTGRES_NODE_BIN_UNVERIFIED >&2; exit 1; }
before_connections="$("$bin/psql" -X -qAt -v ON_ERROR_STOP=1 -h "$sock" -p 55433 -U runner -d postgres -c "select count(*) from pg_stat_activity where datname='$db';")"
[[ "$before_connections" == 0 ]] || { echo T04_POSTGRES_UNEXPECTED_CLIENT_BEFORE_CORE >&2; exit 1; }
if TIGERIQ_PSTACK_SANDBOX_MODE=read-only DATABASE_URL="postgresql://runner@localhost:55433/$db?host=$sock" \
   "$node_bin" apps/tigeriq-core/core.mjs >"$base/core.stdout" 2>"$base/core.stderr"; then
  echo T04_CORE_UNSAFE_SANDBOX_BOOT_ALLOWED >&2
  exit 1
fi
grep -Fq PSTACK_T04_SANDBOX_AUTOWORK_GATE_NOT_ACCEPTED "$base/core.stderr" ||
  { echo T04_CORE_GUARD_NOT_CONFIRMED >&2; exit 1; }
if grep -Eq 'TIGERIQ_CORE_STARTED|CORE_LOOP_ERROR|MANAGER_TICK' "$base/core.stdout"; then
  echo T04_CORE_AUTONOMOUS_STARTUP_DETECTED >&2
  exit 1
fi
after_connections="$("$bin/psql" -X -qAt -v ON_ERROR_STOP=1 -h "$sock" -p 55433 -U runner -d postgres -c "select count(*) from pg_stat_activity where datname='$db';")"
[[ "$after_connections" == 0 ]] || { echo T04_CORE_TOUCHED_DISPOSABLE_DATABASE >&2; exit 1; }
core_denied=1
"$bin/dropdb" -h "$sock" -p 55433 -U runner "$db"
if "$bin/psql" -X -qAt -h "$sock" -p 55433 -U runner -d "$db" -c 'select 1;' >/dev/null 2>&1; then
  echo T04_POSTGRES_DROP_NOT_CONFIRMED >&2; exit 1
fi
"$bin/pg_ctl" -D "$data" -m fast -w stop >/dev/null
started=0
if "$bin/pg_ctl" -D "$data" status >/dev/null 2>&1; then
  echo T04_POSTGRES_PROCESS_STILL_RUNNING >&2; exit 1
fi
verified=1
# Only EXIT cleanup may issue the success receipt after directory removal.
