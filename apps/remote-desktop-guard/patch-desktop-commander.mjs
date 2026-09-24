const IMPORT_ANCHOR="import path from 'path';";
const IMPORT_LINE="import { enforceRemoteToolCall, filterRemoteToolDefinitions, formatRemoteGuardDenial } from './tigeriq-remote-guard/runtime-gate.mjs';";
const LIST_ANCHOR="const filteredTools = allTools.filter(tool => shouldIncludeTool(tool.name));";
const LIST_BLOCK=[
  "const clientTools = allTools.filter(tool => shouldIncludeTool(tool.name));",
  "        const filteredTools = await filterRemoteToolDefinitions(clientTools); // TIGERIQ_REMOTE_GUARD_LIST_V1"
].join('\n');
const CALL_ANCHOR="        setCurrentCallIsRemote(isRemoteCall);";
const CALL_BLOCK=[
  CALL_ANCHOR,
  "        const tigerIqRemoteGuard = await enforceRemoteToolCall({ tool: name, args }); // TIGERIQ_REMOTE_GUARD_CALL_V1",
  "        if (!tigerIqRemoteGuard.ok) {",
  "            return {",
  "                content: [{ type: \"text\", text: formatRemoteGuardDenial(tigerIqRemoteGuard) }],",
  "                isError: true,",
  "            };",
  "        }"
].join('\n');

function replaceOnce(source,anchor,replacement,label) {
  const first=source.indexOf(anchor);
  if (first<0 || source.indexOf(anchor,first+anchor.length)>=0) throw new Error(label+'_ANCHOR_MISMATCH');
  return source.slice(0,first)+replacement+source.slice(first+anchor.length);
}

export function patchDesktopCommanderServer(source) {
  if (typeof source!=='string' || !source.includes(IMPORT_ANCHOR) || !source.includes(CALL_ANCHOR)) {
    throw new Error('DESKTOP_COMMANDER_0_2_51_ANCHOR_MISMATCH');
  }
  let next=source;
  if (!next.includes(IMPORT_LINE)) next=replaceOnce(next,IMPORT_ANCHOR,IMPORT_ANCHOR+'\n'+IMPORT_LINE,'IMPORT');
  if (!next.includes('TIGERIQ_REMOTE_GUARD_LIST_V1')) next=replaceOnce(next,LIST_ANCHOR,LIST_BLOCK,'LIST');
  if (!next.includes('TIGERIQ_REMOTE_GUARD_CALL_V1')) next=replaceOnce(next,CALL_ANCHOR,CALL_BLOCK,'CALL');
  return next;
}

export function verifyDesktopCommanderServerPatched(source) {
  return typeof source==='string'
    && source.includes(IMPORT_LINE)
    && source.includes('TIGERIQ_REMOTE_GUARD_LIST_V1')
    && source.includes('TIGERIQ_REMOTE_GUARD_CALL_V1')
    && source.includes('formatRemoteGuardDenial(tigerIqRemoteGuard)');
}

export function patchRemoteLauncher(source) {
  if (typeof source!=='string') throw new Error('REMOTE_LAUNCHER_INVALID');
  if (source.includes('TIGERIQ_REMOTE_GUARD_LAUNCHER_V1')) return source;
  const anchor='Set-Location $app';
  const guarded=[
    '$guardDir=Join-Path $app "node_modules\\@wonderwhy-er\\desktop-commander\\dist\\tigeriq-remote-guard"',
    '$guardPolicy=Join-Path $guardDir "policy.mjs"',
    '$guardGate=Join-Path $guardDir "runtime-gate.mjs"',
    '$guardServer=Join-Path $app "node_modules\\@wonderwhy-er\\desktop-commander\\dist\\server.js"',
    'if(-not(Test-Path $guardPolicy) -or -not(Test-Path $guardGate) -or -not(Test-Path $guardServer)){ Add-Content $log "$(Get-Date -Format o) TIGERIQ_REMOTE_GUARD_VERIFY_FAIL missing=true"; exit 86 }',
    '$guardText=Get-Content $guardServer -Raw',
    'if($guardText -notmatch "TIGERIQ_REMOTE_GUARD_LIST_V1" -or $guardText -notmatch "TIGERIQ_REMOTE_GUARD_CALL_V1"){ Add-Content $log "$(Get-Date -Format o) TIGERIQ_REMOTE_GUARD_VERIFY_FAIL markers=true"; exit 86 }',
    '$env:TIGERIQ_REMOTE_GUARD="1" # TIGERIQ_REMOTE_GUARD_LAUNCHER_V1',
    '',
    anchor
  ].join('\n');
  return replaceOnce(source,anchor,guarded,'LAUNCHER');
}
