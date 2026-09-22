import { Type } from 'typebox';
import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { executeRuntimeAction } from '../bridge.mjs';
import { executePcAction } from '../operator.mjs';

export default defineToolPlugin({
  id: 'tigeriq-runtime',
  name: 'TigerIQ Runtime',
  description: 'TigerIQ Core/Chrome control plus guarded local PC01 operations.',
  configSchema: Type.Object({
    coreBaseUrl: Type.Optional(Type.String({ default: 'http://100.97.23.87:8795' })),
    chromeBaseUrl: Type.Optional(Type.String({ default: 'http://127.0.0.1:8798' })),
  }, { additionalProperties: false }),
  tools: (tool) => [
    tool({
      name: 'tigeriq_runtime',
      label: 'TigerIQ Runtime',
      description: 'Read TigerIQ runtime truth, invoke allowlisted Chrome Controller actions, or submit a Core objective.',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('core_status'),
          Type.Literal('chrome_snapshot'),
          Type.Literal('chrome_action'),
          Type.Literal('submit_objective'),
        ]),
        command: Type.Optional(Type.Union([
          Type.Literal('start'),
          Type.Literal('focus'),
          Type.Literal('layout'),
          Type.Literal('close'),
          Type.Literal('unblock'),
          Type.Literal('enable'),
          Type.Literal('disable'),
          Type.Literal('start-all'),
          Type.Literal('pause'),
          Type.Literal('resume'),
        ])),
        workerId: Type.Optional(Type.Union([
          Type.Literal('NV02'),
          Type.Literal('NV03'),
          Type.Literal('NV04'),
        ])),
        objective: Type.Optional(Type.String({ minLength: 8, maxLength: 6000 })),
        priority: Type.Optional(Type.Union([
          Type.Literal('P0'),
          Type.Literal('P1'),
          Type.Literal('P2'),
          Type.Literal('P3'),
        ])),
      }, { additionalProperties: false }),
      outputSchema: Type.Object({
        ok: Type.Boolean(),
        action: Type.String(),
        target: Type.String(),
        elapsedMs: Type.Number(),
        data: Type.Unknown(),
        evidence: Type.Object({
          transport: Type.Literal('bounded-http'),
          shell: Type.Literal(false),
          arbitraryFileAccess: Type.Literal(false),
          arbitraryCommandExecution: Type.Literal(false),
        }, { additionalProperties: false }),
      }, { additionalProperties: false }),
      async execute(params, config, context) {
        context?.signal?.throwIfAborted?.();
        return executeRuntimeAction(params, {
          coreBaseUrl: config.coreBaseUrl,
          chromeBaseUrl: config.chromeBaseUrl,
          signal: context?.signal,
        });
      },
    }),
    tool({
      name: 'tigeriq_pc',
      label: 'TigerIQ PC Operator',
      description: 'Operate PC01 with typed task/process/TCP/file actions plus a strict allowlist of diagnostic shell commands. Secret paths, source writes, arbitrary shell, and Production mutations are blocked.',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('shell_exec'),
          Type.Literal('task_status'),
          Type.Literal('task_start'),
          Type.Literal('task_stop'),
          Type.Literal('task_restart'),
          Type.Literal('process_list'),
          Type.Literal('tcp_probe'),
          Type.Literal('file_read'),
          Type.Literal('file_write'),
          Type.Literal('file_list'),
          Type.Literal('file_stat'),
        ]),
        command: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
        shell: Type.Optional(Type.Union([Type.Literal('powershell'), Type.Literal('cmd')])),
        cwd: Type.Optional(Type.String({ minLength: 3, maxLength: 512 })),
        timeoutSec: Type.Optional(Type.Number({ minimum: 1, maximum: 120 })),
        taskName: Type.Optional(Type.String({ minLength: 8, maxLength: 110 })),
        host: Type.Optional(Type.String({ minLength: 3, maxLength: 64 })),
        port: Type.Optional(Type.Number({ minimum: 1, maximum: 65535 })),
        path: Type.Optional(Type.String({ minLength: 3, maxLength: 1024 })),
        content: Type.Optional(Type.String({ maxLength: 524288 })),
      }, { additionalProperties: false }),
      outputSchema: Type.Object({
        ok: Type.Boolean(),
        action: Type.String(),
        target: Type.Literal('pc01-local'),
        elapsedMs: Type.Number(),
        data: Type.Unknown(),
        evidence: Type.Unknown(),
      }, { additionalProperties: false }),
      async execute(params, _config, context) {
        context?.signal?.throwIfAborted?.();
        return executePcAction(params);
      },
    }),
  ],
});
