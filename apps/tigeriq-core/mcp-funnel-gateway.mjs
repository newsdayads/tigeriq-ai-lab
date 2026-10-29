import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPcOperatorMcpHandler } from './pc-operator-mcp.mjs';
import { createOAuthResourceServer, oauthRuntimeConfig } from './pc-operator-oauth-runtime.mjs';

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  }).end(JSON.stringify(body));
}

export function createMcpFunnelGateway({
  port = Number(process.env.TIGERIQ_MCP_PORT || 8805),
  secret = process.env.TIGERIQ_HEALTH_VIEW_KEY,
  fetchImpl = fetch,
  oauthRuntime = null,
  mcpHandler = null,
} = {}) {
  const oauth = oauthRuntime || createOAuthResourceServer({
    config: oauthRuntimeConfig(),
    fetchImpl,
  });
  const oauthConfigured = oauth.configured();
  const handler = mcpHandler || createPcOperatorMcpHandler({
    existingSecret: secret,
    oauthVerifier: oauthConfigured ? oauth : null,
    // Legacy static-Bearer transition only. pc-operator-mcp treats this as a
    // deployment hint and still requires a valid Bearer on every MCP request.
    serverAuthorized: !oauthConfigured,
  });

  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);

    if (url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      if (!oauthConfigured) {
        json(res, 503, { ok: false, reason: 'OAUTH_RUNTIME_NOT_CONFIGURED' });
        return;
      }
      json(res, 200, oauth.protectedMetadata());
      return;
    }

    if (url.pathname === '/.well-known/oauth-authorization-server') {
      if (!oauthConfigured) {
        json(res, 503, { ok: false, reason: 'OAUTH_RUNTIME_NOT_CONFIGURED' });
        return;
      }
      try {
        json(res, 200, oauth.authorizationMetadata());
      } catch {
        json(res, 503, { ok: false, reason: 'OAUTH_AUTHORIZATION_METADATA_INCOMPLETE' });
      }
      return;
    }

    if (url.pathname.startsWith('/mcp')) {
      if (await handler(req, res, url)) return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('NOT_FOUND');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.TIGERIQ_MCP_PORT || 8805);
  createMcpFunnelGateway({ port }).listen(port, '127.0.0.1', () => {
    console.log(`TigerIQ PC Operator Funnel MCP Gateway listening on 127.0.0.1:${port}`);
  });
}
