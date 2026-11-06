import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const host = "127.0.0.1";
const defaultPort = 8879;
const routes = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/robots.txt", ["robots.txt", "text/plain; charset=utf-8"]],
  ["/sitemap.xml", ["sitemap.xml", "application/xml; charset=utf-8"]],
  ["/tigeriq3d-icon.svg", ["tigeriq3d-icon.svg", "image/svg+xml; charset=utf-8"]]
]);
const headers = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://images.unsplash.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests"
};

function respond(res, status, body, type, method) {
  const bytes = Buffer.from(body, "utf8");
  res.writeHead(status, { ...headers, "Content-Type": type, "Content-Length": bytes.byteLength, "Cache-Control": "no-store" });
  res.end(method === "HEAD" ? undefined : bytes);
}
export function createTigerIQ3DServer() {
  return createServer(async (req, res) => {
    const method = req.method ?? "";
    if (method !== "GET" && method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      respond(res, 405, "Method not allowed\n", "text/plain; charset=utf-8", method);
      return;
    }
    let path;
    try { path = new URL(req.url ?? "/", "http://localhost").pathname; }
    catch { respond(res, 400, "Bad request\n", "text/plain; charset=utf-8", method); return; }
    if (path === "/healthz") {
      respond(res, 200, JSON.stringify({ status: "ok", service: "tigeriq-3d" }) + "\n", "application/json; charset=utf-8", method);
      return;
    }
    const route = routes.get(path);
    if (!route) {
      respond(res, 404, "Not found\n", "text/plain; charset=utf-8", method);
      return;
    }
    const [name, type] = route;
    const file = join(root, name);
    try {
      const info = await stat(file);
      if (!info.isFile()) throw Error("not a regular file");
      res.writeHead(200, { ...headers, "Content-Type": type, "Content-Length": info.size, "Cache-Control": name === "index.html" ? "no-store" : "public, max-age=300" });
      if (method === "HEAD") res.end();
      else {
        const stream = createReadStream(file);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      }
    } catch {
      if (!res.headersSent) respond(res, 503, "Static content unavailable\n", "text/plain; charset=utf-8", method);
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.TIGERIQ_3D_PORT ?? defaultPort);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    process.stderr.write("INVALID_TIGERIQ_3D_PORT\n");
    process.exitCode = 2;
  } else {
    const server = createTigerIQ3DServer();
    server.requestTimeout = 10000;
    server.headersTimeout = 12000;
    server.listen(port, host, () => {
      process.stdout.write("TIGERIQ_3D_READY http://" + host + ":" + port + "\n");
    });
    server.on("error", (err) => {
      process.stderr.write("TIGERIQ_3D_BIND_ERROR " + err.code + "\n");
      process.exitCode = 1;
    });
    process.once("SIGTERM", () => server.close());
    process.once("SIGINT", () => server.close());
  }
}
