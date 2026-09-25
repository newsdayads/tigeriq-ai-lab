export const LAUNCHER_MARKER = 'TIGERIQ_REMOTE_GUARD_LAUNCHER_V3';
const ANCHOR = 'Set-Location $app';
const BLOCK = [
  '$guardDir=Join-Path $app "node_modules\\@wonderwhy-er\\desktop-commander\\dist\\tigeriq-remote-guard"',
  '$guardPolicy=Join-Path $guardDir "policy.mjs"',
  '$guardRuntime=Join-Path $guardDir "runtime-gate.mjs"',
  '$server=Join-Path $app "node_modules\\@wonderwhy-er\\desktop-commander\\dist\\server.js"',
  'if(-not(Test-Path $guardPolicy) -or -not(Test-Path $guardRuntime) -or -not(Test-Path $server)){',
  '  Add-Content $log "$(Get-Date -Format o) TIGERIQ_REMOTE_GUARD_VERIFY_FAIL missing=true"',
  '  exit 86',
  '}',
  '$serverText=Get-Content $server -Raw',
  'if($serverText -notmatch "TIGERIQ_REMOTE_GUARD_IMPORT_V3" -or $serverText -notmatch "TIGERIQ_REMOTE_GUARD_LIST_V3" -or $serverText -notmatch "TIGERIQ_REMOTE_GUARD_CALL_V3"){',
  '  Add-Content $log "$(Get-Date -Format o) TIGERIQ_REMOTE_GUARD_VERIFY_FAIL markers=true"',
  '  exit 86',
  '}',
  '# ' + LAUNCHER_MARKER,
  ANCHOR
].join('\n');

export function patchRemoteLauncher(source) {
  if (typeof source !== 'string') throw new Error('REMOTE_LAUNCHER_SOURCE_INVALID');
  if (source.includes(LAUNCHER_MARKER)) return source;
  const first=source.indexOf(ANCHOR);
  if (first < 0 || source.indexOf(ANCHOR,first+ANCHOR.length) >= 0) throw new Error('REMOTE_LAUNCHER_ANCHOR_MISMATCH');
  return source.slice(0,first)+BLOCK+source.slice(first+ANCHOR.length);
}

export function verifyRemoteLauncherPatched(source) {
  return typeof source === 'string'
    && source.includes(LAUNCHER_MARKER)
    && source.includes('TIGERIQ_REMOTE_GUARD_IMPORT_V3')
    && source.includes('TIGERIQ_REMOTE_GUARD_LIST_V3')
    && source.includes('TIGERIQ_REMOTE_GUARD_CALL_V3')
    && source.includes('exit 86');
}
