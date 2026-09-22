import { executeRuntimeAction } from './bridge.mjs';
import { executePcAction } from './operator.mjs';

const CANARY_FILE = 'D:\\TigerIQ\\State\\openclaw-pc-operator-canary.txt';
const CANARY_TEXT = 'TIGERIQ_PC_FILE_WRITE_OK';
const GATEWAY_TASK = 'TigerIQ OpenClaw Gateway';

export async function runDeterministicCanary({
  runtimeAction = executeRuntimeAction,
  pcAction = executePcAction,
} = {}) {
  const core = await runtimeAction({ action: 'core_status' });
  const task = await pcAction({ action: 'task_status', taskName: GATEWAY_TASK });
  const tcp = await pcAction({ action: 'tcp_probe', host: '127.0.0.1', port: 18789 });
  const shell = await pcAction({
    action: 'shell_exec',
    shell: 'cmd',
    cwd: 'D:\\TigerIQ',
    command: 'D:\\OpenClaw\\npm-global\\openclaw.cmd --version',
  });
  const write = await pcAction({ action: 'file_write', path: CANARY_FILE, content: CANARY_TEXT });
  const read = await pcAction({ action: 'file_read', path: CANARY_FILE });

  const checks = {
    coreStatus: core?.ok === true && core?.data?.ok !== false,
    gatewayTask: task?.ok === true && task?.data?.exitCode === 0,
    gatewayTcp: tcp?.ok === true && tcp?.data?.reachable === true,
    shellAllowlist: shell?.ok === true && shell?.data?.exitCode === 0 && shell?.data?.timedOut === false,
    fileWrite: write?.ok === true,
    fileRead: read?.ok === true && read?.data?.content === CANARY_TEXT,
  };
  const pass = Object.values(checks).every(Boolean);
  return {
    schema: 'TIGERIQ_OPENCLAW_CANARY_EXEC_V1',
    result: pass ? 'PASS' : 'BLOCKED',
    reason: pass ? 'PC_OPERATOR_E2E_PASS' : 'PC_OPERATOR_E2E_BLOCKED',
    checks,
  };
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (m) => m.slice(1)).replaceAll('/', '\\').toLowerCase() === process.argv[1].replaceAll('/', '\\').toLowerCase();

if (isMain) {
  runDeterministicCanary()
    .then((result) => {
      process.stdout.write(JSON.stringify(result));
      if (result.result !== 'PASS') process.exitCode = 2;
    })
    .catch((error) => {
      process.stdout.write(JSON.stringify({
        schema: 'TIGERIQ_OPENCLAW_CANARY_EXEC_V1',
        result: 'BLOCKED',
        reason: `CANARY_EXCEPTION_${error?.name || 'Error'}`,
      }));
      process.exitCode = 3;
    });
}
