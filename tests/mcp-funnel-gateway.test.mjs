import { describe, it, expect } from 'vitest';
import { createMcpFunnelGateway } from '../apps/tigeriq-core/mcp-funnel-gateway.mjs';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function oauthStub({ configured }) {
  const issuer = 'https://auth.example.test/';
  const resource = 'https://pc01.example.test/mcp';
  return {
    config: { issuerUrl: issuer, resourceUrl: resource },
    configured: () => configured,
    protectedMetadata: () => ({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ['mcp:read'],
      bearer_methods_supported: ['header'],
    }),
    authorizationMetadata: () => ({
      issuer,
      authorization_endpoint: issuer + 'authorize',
      token_endpoint: issuer + 'token',
      jwks_uri: issuer + '.well-known/jwks.json',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    }),
    verifyBearer: async (headers = {}) => {
      if (headers.authorization === 'Bearer oauth-ok') {
        return {
          ok: true,
          status: 200,
          principal: {
            verified: true,
            iss: issuer,
            aud: [resource],
            sub: 'owner',
            exp: Math.floor(Date.now() / 1000) + 300,
            scopes: ['mcp:read'],
          },
        };
      }
      return { ok: false, status: 401, reason: 'OAUTH_TOKEN_REQUIRED' };
    },
    challenge: () => 'Bearer resource_metadata="https://pc01.example.test/.well-known/oauth-protected-resource/mcp", error="invalid_token"',
  };
}

describe('managed MCP Funnel gateway', () => {
  it('fails closed with static-Bearer fallback when OAuth runtime is not configured', async () => {
    const secret = 's'.repeat(32);
    const server = createMcpFunnelGateway({
      secret,
      oauthRuntime: oauthStub({ configured: false }),
    });
    const port = await listen(server);
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'anonymous', version: '1' } },
        }),
      });
      expect(denied.status).toBe(401);
      expect(await denied.json()).toEqual({ ok: false, reason: 'MCP_PER_REQUEST_AUTH_REQUIRED' });

      const accepted = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 2, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'static-bearer', version: '1' } },
        }),
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.text()).toContain('TigerIQ PC Operator');

      const discovery = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`);
      expect(discovery.status).toBe(503);
      expect(await discovery.json()).toEqual({ ok: false, reason: 'OAUTH_RUNTIME_NOT_CONFIGURED' });
    } finally {
      server.close();
    }
  });

  it('publishes OAuth discovery and requires OAuth Bearer when configured', async () => {
    const oauth = oauthStub({ configured: true });
    const server = createMcpFunnelGateway({ oauthRuntime: oauth });
    const port = await listen(server);
    try {
      const resource = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`);
      expect(resource.status).toBe(200);
      expect((await resource.json()).resource).toBe('https://pc01.example.test/mcp');

      const authorization = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`);
      expect(authorization.status).toBe(200);
      expect((await authorization.json()).code_challenge_methods_supported).toEqual(['S256']);

      const denied = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 3, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'oauth-client', version: '1' } },
        }),
      });
      expect(denied.status).toBe(401);
      expect(denied.headers.get('www-authenticate')).toContain('oauth-protected-resource/mcp');

      const health = await fetch(`http://127.0.0.1:${port}/mcp/health`);
      expect(health.status).toBe(200);
      expect((await health.json()).toolsCount).toBe(25);
    } finally {
      server.close();
    }
  });
});
