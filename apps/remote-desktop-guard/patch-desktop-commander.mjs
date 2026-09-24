const IMPORT_ANCHOR = "import path from 'path';";
const IMPORT_MARKER = "TIGERIQ_REMOTE_GUARD_IMPORT_V3";
const LIST_MARKER = "TIGERIQ_REMOTE_GUARD_LIST_V3";
const CALL_MARKER = "TIGERIQ_REMOTE_GUARD_CALL_V3";
const IMPORT_LINE = "import { enforceRemoteToolCall, filterRemoteToolDefinitions, formatRemoteGuardDenial } from './tigeriq-remote-guard/runtime-gate.mjs'; // " + IMPORT_MARKER;
const LIST_ANCHOR = "        const filteredTools = allTools.filter(tool => shouldIncludeTool(tool.name));";
const LIST_BLOCK = [
  "        const tigerIqClientTools = allTools.filter(tool => shouldIncludeTool(tool.name));",
  "        const filteredTools = await filterRemoteToolDefinitions(tigerIqClientTools); // " + LIST_MARKER
].join('\n');
const CALL_ANCHOR = "        setCurrentCallIsRemote(isRemoteCall);";
const CALL_BLOCK = [
  CALL_ANCHOR,
  "        const tigerIqRemoteGuard = await enforceRemoteToolCall({ tool: name, args }); // " + CALL_MARKER,
  "        if (!tigerIqRemoteGuard.ok) {",
  "            return {",
  "                content: [{ type: \"text\", text: formatRemoteGuardDenial(tigerIqRemoteGuard) }],",
  "                isError: true,",
  "            };",
  "        }",
  "        if (tigerIqRemoteGuard.terminalResult) return tigerIqRemoteGuard.terminalResult;"
].join('\n');

function replaceExactlyOnce(source, anchor, replacement, marker) {
  if (source.includes(marker)) return source;
  const first=source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) throw new Error('DESKTOP_COMMANDER_0_2_51_ANCHOR_MISMATCH:' + marker);
  return source.slice(0,first) + replacement + source.slice(first + anchor.length);
}

export function patchDesktopCommanderServer(source) {
  if (typeof source !== 'string') throw new Error('DESKTOP_COMMANDER_0_2_51_SOURCE_INVALID');
  let next=source;
  next=replaceExactlyOnce(next,IMPORT_ANCHOR,IMPORT_ANCHOR+'\n'+IMPORT_LINE,IMPORT_MARKER);
  next=replaceExactlyOnce(next,LIST_ANCHOR,LIST_BLOCK,LIST_MARKER);
  next=replaceExactlyOnce(next,CALL_ANCHOR,CALL_BLOCK,CALL_MARKER);
  return next;
}

export function verifyDesktopCommanderServerPatched(source) {
  return typeof source === 'string' && [IMPORT_MARKER,LIST_MARKER,CALL_MARKER].every((marker)=>source.includes(marker));
}
