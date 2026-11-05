import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('new-web governance defaults to PC01 and never re-enables Vercel Git deploy', () => {
  const agents = read('AGENTS.md');
  const boundary = read('docs/EXECUTION_BOUNDARY.md');
  const deployment = read('docs/PC01_AUTO_SUBDOMAIN.md');
  const legacy = read('docs/VERCEL_DEPLOYMENT_POLICY.md');
  assert.match(agents, /every NEW website\/app/i);
  assert.match(agents, /No new Vercel project/i);
  assert.match(boundary, /ALL NEW.*PC01/i);
  assert.match(legacy, /SUPERSEDED FOR NEW APPS/);
  assert.match(deployment, /WILDCARD_DNS_PROVISIONED/);
  assert.match(deployment, /ONE_WRITER_CONFIG_GATE/);
  assert.equal(JSON.parse(read('vercel.json')).git.deploymentEnabled, false);
  assert.equal(JSON.parse(read('apps/tigeriq-showcase/vercel.json')).git.deploymentEnabled, false);
});
test('registrar is public opt-in and refuses credentialless service discovery', () => {
  const register = read('scripts/pc01/register-public-webapp.ps1');
  assert.match(register, /PUBLIC_OPT_IN_REQUIRED/);
  assert.match(register, /RESERVED_SUBDOMAIN/);
  assert.match(register, /STATIC_ROUTE_COLLISION/);
  assert.match(register, /ORIGIN_HEALTH_NOT_200/);
  assert.match(register, /PUBLIC_HTTPS_NOT_200/);
  assert.match(register, /FileShare\]::None/);
  assert.match(register, /File\]::Replace/);
});
