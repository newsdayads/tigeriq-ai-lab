/**
 * T04 Linux native process/namespace readback (read-only, no launch).
 *
 * Reads Linux /proc directly. This establishes only process and network
 * namespace identities; it is NOT proof of DB, browser, authenticated
 * operator permissions, source build, complete isolation or T04 acceptance.
 */
import {readFile,readlink} from 'node:fs/promises';

export class LinuxNativeReadbackBlocked extends Error {
  constructor(code) {
    super(code);
    this.name='LinuxNativeReadbackBlocked';
    this.code=code;
  }
}
function requirePid(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)
    throw new LinuxNativeReadbackBlocked('NATIVE_PID_INVALID');
  return pid;
}
function parseStartTicks(stat) {
  // /proc/<pid>/stat comm is inside parentheses and can contain spaces.
  // The 22nd field (starttime) is index 19 after the closing ')' (field 2).
  const closing=stat.lastIndexOf(')');
  if(closing<0)throw new LinuxNativeReadbackBlocked('NATIVE_PROC_STAT_INVALID');
  const fields=stat.slice(closing+1).trim().split(/\s+/);
  const start=fields[19];
  if(!/^\d+$/.test(start||''))
    throw new LinuxNativeReadbackBlocked('NATIVE_PROC_STAT_INVALID');
  return start;
}
export async function readLinuxProcessIdentity(pid) {
  requirePid(pid);
  if(process.platform!=='linux')
    throw new LinuxNativeReadbackBlocked('NATIVE_LINUX_REQUIRED');
  const base='/proc/'+pid;
  try {
    const first=await readFile(base+'/stat','utf8');
    const ns=await readlink(base+'/ns/net');
    const cmdline=await readFile(base+'/cmdline');
    const last=await readFile(base+'/stat','utf8');
    const startTicks=parseStartTicks(first);
    if(startTicks!==parseStartTicks(last))
      throw new LinuxNativeReadbackBlocked('NATIVE_PROCESS_CHANGED');
    if(!/^net:\[\d+\]$/.test(ns))
      throw new LinuxNativeReadbackBlocked('NATIVE_NAMESPACE_INVALID');
    if(cmdline.length===0)
      throw new LinuxNativeReadbackBlocked('NATIVE_PROCESS_NOT_EXECUTABLE');
    // NEVER log or return the process command line: it may contain secrets.
    return {pid,networkNamespace:ns,processStartTicks:startTicks};
  } catch(error) {
    if(error instanceof LinuxNativeReadbackBlocked)throw error;
    throw new LinuxNativeReadbackBlocked('NATIVE_PROCESS_READBACK_UNAVAILABLE');
  }
}
export async function readLinuxIsolatedProcessPair({corePid,bridgePid}={}) {
  requirePid(corePid);
  requirePid(bridgePid);
  if(corePid===bridgePid)
    throw new LinuxNativeReadbackBlocked('NATIVE_CORE_BRIDGE_SAME_PID');
  const [host,core,bridge]=await Promise.all([
    readLinuxProcessIdentity(process.pid),
    readLinuxProcessIdentity(corePid),
    readLinuxProcessIdentity(bridgePid)
  ]);
  if(core.networkNamespace===host.networkNamespace)
    throw new LinuxNativeReadbackBlocked('NATIVE_CORE_HOST_NAMESPACE_SHARED');
  if(bridge.networkNamespace!==core.networkNamespace)
    throw new LinuxNativeReadbackBlocked('NATIVE_BRIDGE_NAMESPACE_MISMATCH');
  return {
    source:'LINUX_PROC_READ_ONLY',
    observedAt:new Date().toISOString(),
    host,core,bridge,
    createdResources:false,
    nativeFullStackAccepted:false
  };
}
