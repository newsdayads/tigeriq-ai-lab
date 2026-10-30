import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, openSync, closeSync, fsyncSync, renameSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

export function verifyWindowsAcl(targetPath) {
  if (process.platform !== 'win32') return { secure: true, platform: process.platform };
  try {
    const out = execFileSync('icacls', [targetPath], { encoding: 'utf8', timeout: 3000 });
    const insecure = /(?:Everyone|BUILTIN\\Users|Users|Authenticated Users):(?:\(I\))?(?:\([A-Z]+\))*(?:\(F\)|\(M\)|\(W\))/i.test(out);
    return { secure: !insecure, acl: out.trim() };
  } catch (error) {
    return { secure: false, error: error.message };
  }
}

export function ensureSecureWindowsAcl(targetPath) {
  if (process.platform !== 'win32') return false;
  try {
    const isDir = existsSync(targetPath) && statSync(targetPath).isDirectory();
    const perm = isDir ? '(OI)(CI)F' : 'F';
    const user = process.env.USERNAME || 'PC01\\wdragons12x';
    execFileSync('icacls', [
      targetPath,
      '/inheritance:r',
      '/grant:r', `*S-1-5-18:${perm}`,
      '/grant:r', `*S-1-5-32-544:${perm}`,
      '/grant:r', `${user}:${perm}`,
    ], { encoding: 'utf8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

let activeLockPath = null;
export function withFileLock(lockPath, fn, { timeoutMs = 5000, retryMs = 25 } = {}) {
  if (activeLockPath === lockPath) {
    return fn();
  }
  const start = Date.now();
  let fd = null;
  while (true) {
    try {
      fd = openSync(lockPath, 'wx');
      writeFileSync(fd, `${process.pid}\n${Date.now()}`);
      break;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const stat = statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 10000) {
            unlinkSync(lockPath);
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() - start >= timeoutMs) {
          throw new Error('SESSION_STORE_LOCK_TIMEOUT');
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryMs);
      } else {
        throw err;
      }
    }
  }

  activeLockPath = lockPath;
  try {
    return fn();
  } finally {
    activeLockPath = null;
    if (fd !== null) {
      try { closeSync(fd); } catch {}
    }
    try { unlinkSync(lockPath); } catch {}
  }
}

export function atomicWriteFile(filePath, content, mode = 0o600) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    ensureSecureWindowsAcl(dir);
  }
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  let fd = null;
  try {
    fd = openSync(tmpPath, 'w', mode);
    writeFileSync(fd, content, { encoding: 'utf8' });
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    ensureSecureWindowsAcl(tmpPath);
    renameSync(tmpPath, filePath);
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch {}
    }
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch {}
    }
  }
}

export function resolveDefaultStorePath(envPath = process.env.TIGERIQ_OAUTH_SESSION_STORE) {
  if (envPath) return envPath;
  const preferredDir = 'C:\\ProgramData\\TigerIQMcpSessions';
  try {
    if (!existsSync(preferredDir)) {
      mkdirSync(preferredDir, { recursive: true });
      ensureSecureWindowsAcl(preferredDir);
    }
    return path.join(preferredDir, 'sessions.json');
  } catch {
    try {
      const authDir = 'C:\\ProgramData\\TigerIQMcpAuth';
      if (existsSync(authDir)) return path.join(authDir, 'sessions.json');
    } catch {}
    return 'D:\\TigerIQ\\State\\mcp-oauth-sessions.json';
  }
}

export function createOAuthSessionStore(filePath = resolveDefaultStorePath()) {
  const lockPath = filePath + '.lock';

  const load = () => {
    try {
      if (!existsSync(filePath)) return [];
      const content = readFileSync(filePath, 'utf8').trim();
      if (!content) return [];
      const value = JSON.parse(content);
      return Array.isArray(value) ? value : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      const bakPath = filePath + '.bak';
      try {
        if (existsSync(bakPath)) {
          const bakContent = readFileSync(bakPath, 'utf8').trim();
          if (bakContent) {
            const bakValue = JSON.parse(bakContent);
            if (Array.isArray(bakValue)) return bakValue;
          }
        }
      } catch {}
      return [];
    }
  };

  const saveInternal = sessions => {
    atomicWriteFile(filePath, JSON.stringify(sessions, null, 2));
    try {
      atomicWriteFile(filePath + '.bak', JSON.stringify(sessions));
    } catch {}
  };

  const save = sessions => {
    withFileLock(lockPath, () => {
      saveInternal(sessions);
    });
  };

  const rotate = (oldHash, newHash, nextGrant = null) => {
    return withFileLock(lockPath, () => {
      const sessions = load();
      for (const s of sessions) {
        if (Array.isArray(s.spentHashes) && s.spentHashes.includes(oldHash)) {
          s.revoked = true;
          s.revokedReason = 'replay_detected';
          s.revokedAt = Date.now();
          saveInternal(sessions);
          return { replay: true, session: s };
        }
      }

      const target = sessions.find(s => (s.activeHash === oldHash || s.hash === oldHash) && !s.revoked);
      if (!target) return { notFound: true };

      target.spentHashes = target.spentHashes || [];
      if (!target.spentHashes.includes(oldHash)) {
        target.spentHashes.push(oldHash);
      }
      target.activeHash = newHash;
      target.hash = newHash;
      target.updatedAt = Date.now();
      if (nextGrant && nextGrant.scopes) target.scopes = nextGrant.scopes;

      saveInternal(sessions);
      return { success: true, session: target };
    });
  };

  const revoke = (hashOrTokenHash, reason = 'explicit_revocation') => {
    return withFileLock(lockPath, () => {
      const sessions = load();
      let matched = false;
      for (const s of sessions) {
        const matchesActive = s.activeHash === hashOrTokenHash || s.hash === hashOrTokenHash;
        const matchesSpent = Array.isArray(s.spentHashes) && s.spentHashes.includes(hashOrTokenHash);
        if (matchesActive || matchesSpent) {
          s.revoked = true;
          s.revokedReason = reason;
          s.revokedAt = Date.now();
          matched = true;
        }
      }
      if (matched) {
        saveInternal(sessions);
      }
      return matched;
    });
  };

  return {
    filePath,
    lockPath,
    load,
    save,
    rotate,
    revoke,
  };
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
