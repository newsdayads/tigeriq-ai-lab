import { describe, it, expect } from 'vitest';
import { runtimeGatewayModulePath } from '../scripts/tigeriq-core/mcp-funnel-gateway-runtime.mjs';
import { gatewayDependencyPaths } from '../apps/tigeriq-core/mcp-funnel-gateway.mjs';

describe('MCP Funnel runtime wrapper', () => {
  it('resolves canonical gateway from CoreSource instead of the runtime wrapper directory', () => {
    expect(runtimeGatewayModulePath()).toBe(
      'D:\\TigerIQ\\Runtime\\CoreSource\\apps\\tigeriq-core\\mcp-funnel-gateway.mjs',
    );
    expect(runtimeGatewayModulePath('E:\\IsolatedCore')).toBe(
      'E:\\IsolatedCore\\apps\\tigeriq-core\\mcp-funnel-gateway.mjs',
    );
  });

  it('relocated canonical gateway loads dependencies from CoreSource, not runtime sibling files', () => {
    expect(gatewayDependencyPaths(
      'file:///D:/TigerIQ/Runtime/McpFunnelGateway/server.mjs',
      'E:\\VerifiedCore\\apps\\tigeriq-core',
    )).toEqual({
      pcOperator: 'E:\\VerifiedCore\\apps\\tigeriq-core\\pc-operator-mcp.mjs',
      oauthRuntime: 'E:\\VerifiedCore\\apps\\tigeriq-core\\pc-operator-oauth-runtime.mjs',
    });
  });

  it('source gateway keeps normal local dependency resolution', () => {
    const sourceUrl = new URL('../apps/tigeriq-core/mcp-funnel-gateway.mjs', import.meta.url).href;
    const deps = gatewayDependencyPaths(sourceUrl);
    expect(deps.pcOperator.replaceAll('\\\\','/')).toContain('/apps/tigeriq-core/pc-operator-mcp.mjs');
    expect(deps.oauthRuntime.replaceAll('\\\\','/')).toContain('/apps/tigeriq-core/pc-operator-oauth-runtime.mjs');
  });
});
