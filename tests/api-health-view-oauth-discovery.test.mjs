import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthViewGateway } from '../apps/tigeriq-core/api-health-view-gateway.mjs';

const secret = 'unit-test-secret-that-is-long-enough-and-not-real';
const oauthRuntime = {
  configured: () => true,
  protectedMetadata: () => ({
    resource: 'https://pc01.example.test/mcp',
    authorization_servers: ['https://auth.example.test/'],
    scopes_supported: ['mcp:read'],
    bearer_methods_supported: ['header'],
  }),
  authorizationMetadata: () => ({
    issuer: 'https://auth.example.test/',
    authorization_endpoint: 'https://auth.example.test/authorize',
    token_endpoint: 'https://auth.example.test/token',
    jwks_uri: 'https://auth.example.test/.well-known/jwks.json',
    code_challenge_methods_supported: ['S256'],
  }),
};
test('gateway serves OAuth discovery instead of 404', async () => {
  const server = createHealthViewGateway({
    secret, oauthRuntime, mcpHandler: async () => false,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const resource = await fetch(base + '/.well-known/oauth-protected-resource/mcp');
    const authorization = await fetch(base + '/.well-known/oauth-authorization-server');
    assert.equal(resource.status, 200);
    assert.equal((await resource.json()).authorization_servers[0], 'https://auth.example.test/');
    assert.equal(authorization.status, 200);
    assert.deepEqual((await authorization.json()).code_challenge_methods_supported, ['S256']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
