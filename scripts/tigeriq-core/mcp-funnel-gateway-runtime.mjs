import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function runtimeGatewayModulePath(
  runtimeSourcePath = process.env.TIGERIQ_CORE_RUNTIME_SOURCE || 'D:\\TigerIQ\\Runtime\\CoreSource',
) {
  return path.win32.join(runtimeSourcePath, 'apps', 'tigeriq-core', 'mcp-funnel-gateway.mjs');
}

export async function startManagedMcpFunnelGateway({
  runtimeSourcePath,
  port = Number(process.env.TIGERIQ_MCP_PORT || 8805),
} = {}) {
  const modulePath = runtimeGatewayModulePath(runtimeSourcePath);
  const gateway = await import(pathToFileURL(modulePath).href);
  const server = gateway.createMcpFunnelGateway({ port });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`TigerIQ PC Operator Funnel MCP Gateway listening on 127.0.0.1:${port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startManagedMcpFunnelGateway();
}
