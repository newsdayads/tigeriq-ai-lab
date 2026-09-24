const IMPORT_ANCHOR = "import path from 'path';";
const IMPORT_LINE = "import { enforceRemoteToolCall, formatRemoteGuardDenial } from './tigeriq-remote-guard/runtime-gate.mjs';";
const CALL_ANCHOR = "        setCurrentCallIsRemote(isRemoteCall);";
const CALL_BLOCK = [
  CALL_ANCHOR,
  "        const tigerIqRemoteGuard = await enforceRemoteToolCall({ tool: name, args });",
  "        if (!tigerIqRemoteGuard.ok) {",
  "            return {",
  "                content: [{ type: \"text\", text: formatRemoteGuardDenial(tigerIqRemoteGuard) }],",
  "                isError: true,",
  "            };",
  "        }"
].join('\n');

export function patchDesktopCommanderServer(source) {
  if (typeof source !== 'string' || !source.includes(IMPORT_ANCHOR) || !source.includes(CALL_ANCHOR)) {
    throw new Error('DESKTOP_COMMANDER_0_2_51_ANCHOR_MISMATCH');
  }
  let next = source;
  if (!next.includes(IMPORT_LINE)) next = next.replace(IMPORT_ANCHOR, IMPORT_ANCHOR + '\n' + IMPORT_LINE);
  if (!next.includes('const tigerIqRemoteGuard = await enforceRemoteToolCall')) next = next.replace(CALL_ANCHOR,CALL_BLOCK);
  return next;
}

export function verifyDesktopCommanderServerPatched(source) {
  return typeof source === 'string'
    && source.includes(IMPORT_LINE)
    && source.includes('const tigerIqRemoteGuard = await enforceRemoteToolCall')
    && source.includes('formatRemoteGuardDenial(tigerIqRemoteGuard)');
}
