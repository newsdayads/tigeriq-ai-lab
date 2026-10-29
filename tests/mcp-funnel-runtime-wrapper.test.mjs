import { describe, it, expect } from 'vitest';
import { runtimeGatewayModulePath } from '../scripts/tigeriq-core/mcp-funnel-gateway-runtime.mjs';

describe('MCP Funnel runtime wrapper', () => {
  it('resolves canonical gateway from CoreSource instead of the runtime wrapper directory', () => {
    expect(runtimeGatewayModulePath()).toBe(
      'D:\\TigerIQ\\Runtime\\CoreSource\\apps\\tigeriq-core\\mcp-funnel-gateway.mjs',
    );
    expect(runtimeGatewayModulePath('E:\\IsolatedCore')).toBe(
      'E:\\IsolatedCore\\apps\\tigeriq-core\\mcp-funnel-gateway.mjs',
    );
  });
});
