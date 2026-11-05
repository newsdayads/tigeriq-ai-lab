import { createServer, request as proxyRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DOMAIN = 'tigeriq.io.vn';
const DEFAULT_REGISTRY = 'D:\\TigerIQ\\CloudflareRuntime\\subdomains.json';
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function getHost(header) {
  if (typeof header !== 'string') return null;
  const value = header.toLowerCase().split(':')[0];
  const suffix = '.' + DOMAIN;
  if (!value.endsWith(suffix)) return null;
  const label = value.slice(0, -suffix.length);
  return LABEL.test(label) ? value : null;
}

export function resolveRoute(header, registryPath) {
  const host = getHost(header);
  if (!host) return null;
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    return null;
  }
  if (registry?.version !== 1 || typeof registry?.routes !== 'object' || !registry.routes) return null;
  const entry = registry.routes[host];
  const port = Number(entry?.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return { host, port };
}

export function createRouterServer({ registryPath = DEFAULT_REGISTRY } = {}) {
  const server = createServer((incoming, outgoing) => {
    if (incoming.socket.remoteAddress === '127.0.0.1' &&
        incoming.url === '/__router/healthz' &&
        (incoming.headers.host === '127.0.0.1' || incoming.headers.host === 'localhost')) {
      outgoing.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end('{"status":"ok","service":"tigeriq-subdomain-router"}');
      return;
    }
    const route = resolveRoute(incoming.headers.host, registryPath);
    if (!route) {
      outgoing.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      outgoing.end('Not Found');
      return;
    }
    const headers = { ...incoming.headers, host: '127.0.0.1:' + route.port, 'x-forwarded-host': route.host, 'x-forwarded-proto': 'https' };
    delete headers['proxy-authorization'];
    const request = proxyRequest({
      hostname: '127.0.0.1',
      port: route.port,
      method: incoming.method,
      path: incoming.url,
      headers,
      timeout: 15000
    }, (response) => {
      outgoing.writeHead(response.statusCode || 502, response.headers);
      response.pipe(outgoing);
    });
    request.on('timeout', () => request.destroy(new Error('UPSTREAM_TIMEOUT')));
    request.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'text/plain' });
      outgoing.end('Bad Gateway');
    });
    incoming.pipe(request);
  });

  server.on('upgrade', (incoming, client, head) => {
    const route = resolveRoute(incoming.headers.host, registryPath);
    if (!route) { client.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    const headers = { ...incoming.headers, host: '127.0.0.1:' + route.port, 'x-forwarded-host': route.host, 'x-forwarded-proto': 'https' };
    delete headers['proxy-authorization'];
    const upstream = proxyRequest({ hostname: '127.0.0.1', port: route.port, path: incoming.url, headers });
    upstream.on('upgrade', (response, socket, upstreamHead) => {
      let headText = 'HTTP/1.1 101 Switching Protocols\r\n';
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) headText += key + ': ' + value + '\r\n';
      }
      client.write(headText + '\r\n');
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) socket.write(head);
      client.pipe(socket).pipe(client);
    });
    upstream.on('response', () => client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
    upstream.on('error', () => client.destroy());
    upstream.end();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.TIGERIQ_SUBDOMAIN_ROUTER_PORT || 8891);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ROUTER_PORT_INVALID');
  const server = createRouterServer({ registryPath: process.env.TIGERIQ_SUBDOMAIN_REGISTRY || DEFAULT_REGISTRY });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write('TIGERIQ_SUBDOMAIN_ROUTER_READY 127.0.0.1:' + port + '\n');
  });
}
