import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createPc01AuthorizationServer } from './pc01-authorization-server.mjs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_RUNTIME_CORE_DIR = 'D:\\TigerIQ\\Runtime\\CoreSource\\apps\\tigeriq-core';

export function gatewayDependencyPaths(
  moduleUrl = import.meta.url,
  runtimeCoreDir = process.env.TIGERIQ_CORE_RUNTIME_APP_DIR || DEFAULT_RUNTIME_CORE_DIR,
) {
  const modulePath = fileURLToPath(moduleUrl);
  const normalized = modulePath.replaceAll('\\\\','/').toLowerCase();
  const relocated = normalized.endsWith('/tigeriq/runtime/mcpfunnelgateway/server.mjs');
  const base = relocated ? runtimeCoreDir : path.dirname(modulePath);
  const join = relocated ? path.win32.join : path.join;
  return {
    pcOperator: join(base, 'pc-operator-mcp.mjs'),
    oauthRuntime: join(base, 'pc-operator-oauth-runtime.mjs'),
  };
}

const dependencyPaths = gatewayDependencyPaths();
const [
  { createPcOperatorMcpHandler },
  { createOAuthResourceServer, oauthRuntimeConfig },
] = await Promise.all([
  import(pathToFileURL(dependencyPaths.pcOperator).href),
  import(pathToFileURL(dependencyPaths.oauthRuntime).href),
]);

export function createOAuthSessionStore(filePath = process.env.TIGERIQ_OAUTH_SESSION_STORE || 'C:\\ProgramData\\TigerIQMcpAuth\\sessions.json') {
  const load = () => { try { const value = JSON.parse(readFileSync(filePath, 'utf8')); return Array.isArray(value) ? value : []; } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
  const save = sessions => { mkdirSync(path.dirname(filePath), {recursive:true}); writeFileSync(filePath, JSON.stringify(sessions), {encoding:'utf8', mode:0o600}); };
  const revoke = hash => { const next = load().filter(item => item.hash !== hash); save(next); };
  return {load, save, revoke};
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  }).end(JSON.stringify(body));
}

export function loadPc01AuthorizationConfig(env = process.env) {
  const configPath = env.TIGERIQ_MCP_SELF_HOSTED_AUTH_CONFIG || 'C:\\ProgramData\\TigerIQMcpAuth\\config.json';
  if (!existsSync(configPath)) return null;
  const stat = lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw Error('SELF_HOSTED_CONFIG_INVALID');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (config.schema !== 'TIGERIQ_PC01_OAUTH_AUTHORITY_V1') throw Error('SELF_HOSTED_CONFIG_SCHEMA_INVALID');
  return config;
}

export function createMcpFunnelGateway({
  port = Number(process.env.TIGERIQ_MCP_PORT || 8805),
  secret = process.env.TIGERIQ_HEALTH_VIEW_KEY,
  fetchImpl = fetch,
  oauthRuntime = null,
  mcpHandler = null,
  selfHostedAuthConfig = loadPc01AuthorizationConfig(),
  oauthSessionStore = createOAuthSessionStore(),
} = {}) {
  const authority = selfHostedAuthConfig ? createPc01AuthorizationServer({
    config: selfHostedAuthConfig, fetchImpl, sessionStore: oauthSessionStore,
    audit: event => console.log(JSON.stringify({service:'pc01-oauth',...event})),
  }) : null;
  const oauth = oauthRuntime || createOAuthResourceServer({
    config: authority ? authority.config : oauthRuntimeConfig(),
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

    if (authority && await authority.handle(req, res, url)) return;

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
