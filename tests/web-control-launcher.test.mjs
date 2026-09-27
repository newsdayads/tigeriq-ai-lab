import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const launcherUrl = new URL('../scripts/tigeriq-core/run-web-control-bundle.ps1', import.meta.url);

test('Web Control launcher waits for an actually assigned Tailscale IPv4 before binding', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /function Wait-TailscaleIPv4/);
  assert.match(source, /Get-NetIPAddress -AddressFamily IPv4/);
  assert.match(source, /InterfaceAlias -match '\(\?i\)tailscale'/);
  assert.match(source, /C:\\\\Program Files\\\\Tailscale\\\\tailscale\.exe/);
  assert.match(source, /TAILSCALE_IPV4_NOT_READY/);
  assert.match(source, /Wait-TailscaleIPv4 90/);
  assert.doesNotMatch(source, /if\(\$tail\).*127\.0\.0\.1/);
});

test('Web Control keeps Core and Coding upstreams on the confirmed Tailscale host', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /TIGERIQ_WEB_CONTROL_HOST=\$hostIp/);
  assert.match(source, /TIGERIQ_CORE_URL=\('http:\/\/'\+\$hostIp\+':8795'\)/);
  assert.match(source, /TIGERIQ_CODING_LANE_URL=\('http:\/\/'\+\$hostIp\+':8797'\)/);
});

test('Web Control launcher records bounded startup failure evidence', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /D:\\\\TigerIQ\\\\Logs\\\\WebControl24x7/);
  assert.match(source, /launcher\.log/);
  assert.match(source, /Log \('ERROR '/);
});
