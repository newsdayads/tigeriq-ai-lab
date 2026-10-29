import {it as test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url),'utf8');

test('recovery helper is unique and does not duplicate updater code',()=>{
  expect(source.match(/function Resolve-DeployedSourceSha/g)).toHaveLength(1);
  expect(source.match(/function Runtime-Source-Dirty/g)).toHaveLength(1);
  expect(source.match(/function Restart-Core/g)).toHaveLength(1);
  expect(source.match(/function Gates-Pass/g)).toHaveLength(1);
  expect(source.length).toBeLessThan(68000); // Includes bounded MCP Funnel gateway lifecycle checks without duplicating updater code.
});
test('installed metadata must match worktree and be a valid known commit',()=>{
  const block=source.slice(source.indexOf('function Resolve-DeployedSourceSha'),source.indexOf('function Runtime-Source-Dirty'));
  expect(block).toMatch(/meta\.sourcePath -ne \$runtimeRepo/);
  expect(block).toMatch(/recorded -notmatch '\^\[a-f0-9\]\{40\}\$'/);
  expect(block).toContain("Head $controlRepo ($recorded+'^{commit}')");
  expect(block).toMatch(/knownCommit -ne \$recorded/);
  expect(block).toContain('catch{return $checkedOutSha}');
});
test('stale marker gets reconciled before no-change short circuit',()=>{
  const resolve=source.indexOf('$local=Resolve-DeployedSourceSha $local $remote');
  const noChange=source.indexOf("Save-State @{result='NO_CHANGE'");
  const gates=source.indexOf('$gateSha=Resolve-GateSha $remote');
  const changed=source.indexOf('Get-Impact $changed',gates);
  expect(resolve).toBeGreaterThan(0);
  expect(noChange).toBeGreaterThan(resolve);
  expect(gates).toBeGreaterThan(noChange);
  expect(changed).toBeGreaterThan(gates);
});
test('old installed baseline uses existing guarded apply, restart and rollback paths',()=>{
  expect(source).toContain('Save-RuntimeSourceState $remote $previousRuntimeSha $gateSha');
  expect(source).toContain('if($impact.core){$coreHealth=Restart-Core $oldPid');
  expect(source).toContain('Invoke-RuntimeRollback $previousRuntimeSha $remote $impact');
  expect(source).toContain("if(-not $gateSha){Save-State @{result='WAIT_GATES'");
});
test('reconciles standalone MCP Funnel gateway only through exact supervised topology',()=>{
  expect(source.match(/function Get-McpFunnelGatewayTopology/g)).toHaveLength(1);
  expect(source.match(/function Reconcile-McpFunnelGatewayRuntime/g)).toHaveLength(1);
  expect(source).toContain("$mcpGatewayServerPath='D:\\TigerIQ\\Runtime\\McpFunnelGateway\\server.mjs'");
  expect(source).toContain("$mcpGatewaySupervisorPaths=@('D:\\TigerIQ\\Runtime\\McpFunnelGateway\\run-mcp-gateway.cmd','D:\\TigerIQ\\Runtime\\McpFunnelGateway\\run-mcp-gateway.ps1')");
  expect(source).toContain("reason='MCP_GATEWAY_TOPOLOGY_UNVERIFIED'");
  expect(source).toContain("$supervisors.Count -ne 1 -or $children.Count -gt 1");
  expect(source).toContain("$spawnDeadline=(Get-Date).AddSeconds(12)");
  expect(source).toContain("Start-Sleep -Milliseconds 500");
  expect(source).toContain("reason='MCP_GATEWAY_CHILD_RESPAWN_TIMEOUT'");
  expect(source).toContain("Stop-Process -Id $oldPid -Force -ErrorAction Stop");
  expect(source).toContain("[int]$new[0].ProcessId -ne $oldPid");
  expect(source).toContain("Test-TcpPort '127.0.0.1' $mcpGatewayPort");
  const reconcileBlock=source.slice(
    source.indexOf('function Reconcile-McpFunnelGatewayRuntime'),
    source.indexOf('function Get-CorePid'),
  );
  expect(reconcileBlock).not.toContain('Start-Process');
  expect(reconcileBlock).not.toContain('Start-Job');
  const noChangeSync=source.indexOf('$mcpGatewaySync=Sync-McpFunnelGatewayRuntime');
  const noChangeReconcile=source.indexOf("else{Reconcile-McpFunnelGatewayRuntime $local}",noChangeSync);
  expect(noChangeSync).toBeGreaterThan(0);
  expect(noChangeReconcile).toBeGreaterThan(noChangeSync);
  expect(source).toContain("$mcpGatewayReconcile=Reconcile-McpFunnelGatewayRuntime $remote");
  expect(source).toContain("$mcpRollback=if(-not $CanaryMode){Reconcile-McpFunnelGatewayRuntime $previousRuntimeSha}");
  expect(source.match(/function Sync-McpFunnelGatewayRuntime/g)).toHaveLength(1);
  expect(source).toContain("$mcpGatewaySourcePath=(Join-Path $runtimeRepo 'scripts\\tigeriq-core\\mcp-funnel-gateway-runtime.mjs')");
  expect(source).toContain("MCP_GATEWAY_SYNC_HASH_MISMATCH");
  expect(source).toContain("MCP_GATEWAY_CANONICAL_SOURCE_AND_BACKUP_MISSING");
  expect(source).toContain("$backup=$mcpGatewayServerPath+'.previous'");
  expect(source).toContain("action='restored_previous'");
  expect(source.indexOf('$mcpGatewaySync=Sync-McpFunnelGatewayRuntime')).toBeLessThan(source.indexOf('$mcpGatewayReconcile=Reconcile-McpFunnelGatewayRuntime $remote'));
});

