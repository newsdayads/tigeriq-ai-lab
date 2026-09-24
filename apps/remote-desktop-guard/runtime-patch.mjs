export const IMPORT_MARKER = 'TIGERIQ_REMOTE_GUARD_IMPORT_V1';
export const LIST_MARKER = 'TIGERIQ_REMOTE_GUARD_LIST_V1';
export const CALL_MARKER = 'TIGERIQ_REMOTE_GUARD_CALL_V1';

const IMPORT_LINE = 'import { enforceRemoteToolCall, filterRemoteTools } from "file:///D:/TigerIQ/Runtime/desktop-commander-remote/tigeriq-remote-guard.mjs"; // ' + IMPORT_MARKER;

function replaceExactlyOnce(source, oldText, newText, marker) {
  if (source.includes(marker)) return source;
  const first = source.indexOf(oldText);
  if (first < 0 || source.indexOf(oldText, first + oldText.length) >= 0) throw new Error('PATCH_ANCHOR_NOT_EXACT:' + marker);
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

export function patchDesktopCommanderServer(input) {
  let source = String(input);
  source = replaceExactlyOnce(
    source,
    "import path from 'path';",
    "import path from 'path';\n" + IMPORT_LINE,
    IMPORT_MARKER
  );

  source = replaceExactlyOnce(
    source,
    "const filteredTools = allTools.filter(tool => shouldIncludeTool(tool.name));",
    "const clientTools = allTools.filter(tool => shouldIncludeTool(tool.name));\n        const tigerIqRemote = process.env.TIGERIQ_REMOTE_GUARD === '1' || isRemoteClientContext(currentClient?.name);\n        const filteredTools = await filterRemoteTools(clientTools, { remote:tigerIqRemote }); // " + LIST_MARKER,
    LIST_MARKER
  );

  const callAnchor = "        // Track tool call\n        trackToolCall(name, args);";
  const callGuard = "        const tigerIqRemote = process.env.TIGERIQ_REMOTE_GUARD === '1' || isRemoteCall || isRemoteClientContext(currentClient?.name);\n        const tigerIqGuard = await enforceRemoteToolCall({ remote:tigerIqRemote, tool:name, args:args || {} }); // " + CALL_MARKER + "\n        if (!tigerIqGuard.ok) {\n            return { content:[{ type:'text', text:'TIGERIQ_REMOTE_BLOCKED:' + tigerIqGuard.reason }], isError:true };\n        }\n        // Track tool call\n        trackToolCall(name, args);";
  source = replaceExactlyOnce(source, callAnchor, callGuard, CALL_MARKER);
  return source;
}

export function verifyPatchedServer(source) {
  const text = String(source);
  return [IMPORT_MARKER, LIST_MARKER, CALL_MARKER].every((marker) => text.includes(marker));
}

export function patchRemoteLauncher(input) {
  let source = String(input);
  if (source.includes('TIGERIQ_REMOTE_GUARD_LAUNCHER_V1')) return source;
  const anchor = 'Set-Location $app';
  const guarded = '$guard=Join-Path $root "tigeriq-remote-guard.mjs"\n$server=Join-Path $app "node_modules\\@wonderwhy-er\\desktop-commander\\dist\\server.js"\nif(-not(Test-Path $guard) -or -not(Test-Path $server)){ Add-Content $log "$(Get-Date -Format o) TIGERIQ_REMOTE_GUARD_VERIFY_FAIL missing=true"; exit 86 }\n$serverText=Get-Content $server -Raw\nif($serverText -notmatch "TIGERIQ_REMOTE_GUARD_IMPORT_V1" -or $serverText -notmatch "TIGERIQ_REMOTE_GUARD_LIST_V1" -or $serverText -notmatch "TIGERIQ_REMOTE_GUARD_CALL_V1"){ Add-Content $log "$(Get-Date -Format o) TIGERIQ_REMOTE_GUARD_VERIFY_FAIL markers=true"; exit 86 }\n$env:TIGERIQ_REMOTE_GUARD="1" # TIGERIQ_REMOTE_GUARD_LAUNCHER_V1\n\nSet-Location $app';
  return replaceExactlyOnce(source, anchor, guarded, 'TIGERIQ_REMOTE_GUARD_LAUNCHER_V1');
}
