import { Type } from 'typebox';
import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { executeRuntimeAction } from '../bridge.mjs';

export default defineToolPlugin({
  id: 'tigeriq-runtime',
  name: 'TigerIQ Runtime',
  description: 'Bounded PC01 runtime control for TigerIQ Core and Chrome Controller. No shell or arbitrary file access.',
  configSchema: Type.Object({
    coreBaseUrl: Type.Optional(Type.String({ default: 'http://127.0.0.1:8795' })),
    chromeBaseUrl: Type.Optional(Type.String({ default: 'http://127.0.0.1:8798' })),
  }, { additionalProperties: false }),
  tools: (tool) => [
    tool({
      name: 'tigeriq_runtime',
      label: 'TigerIQ Runtime',
      description: 'Read TigerIQ runtime truth, invoke allowlisted Chrome Controller actions, or submit a Core objective. Never exposes shell, arbitrary paths, credentials, or browser session data.',
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
          transport: Type.Literal('loopback-http'),
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
  ],
});
