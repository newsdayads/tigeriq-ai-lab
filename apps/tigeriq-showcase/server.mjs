import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = dirname(fileURLToPath(import.meta.url));
const bindingHost = "127.0.0.1";
const defaultPort = 8878;
const allowedFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/main.js", ["main.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml; charset=utf-8"]],
  ["/approved-tig-icon.svg", ["approved-tig-icon.svg", "image/svg+xml; charset=utf-8"]],
  ["/approved-tig-logo.svg", ["approved-tig-logo.svg", "image/svg+xml; charset=utf-8"]],
  ["/robots.txt", ["robots.txt", "text/plain; charset=utf-8"]],
  ["/sitemap.xml", ["sitemap.xml", "application/xml; charset=utf-8"]]
]);

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests"
};

function send(response, status, body, contentType, method = "GET") {
  const data = Buffer.from(body, "utf8");
  response.writeHead(status, { ...securityHeaders, "Content-Type": contentType, "Content-Length": data.length, "Cache-Control": "no-store" });
  response.end(method === "HEAD" ? undefined : data);
}

export function createShowcaseServer() {
  return createServer(async (request, response) => {
    const method = request.method ?? "";
    if (method !== "GET" && method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      send(response, 405, "Method not allowed\n", "text/plain; charset=utf-8", method);
      return;
    }
    let url;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      send(response, 400, "Bad request\n", "text/plain; charset=utf-8", method);
      return;
    }
    if (url.pathname === "/healthz") {
      send(response, 200, JSON.stringify({ status: "ok", service: "tigeriq-showcase" }) + "\n", "application/json; charset=utf-8", method);
      return;
    }
    const route = allowedFiles.get(url.pathname);
    if (!route) {
      send(response, 404, "Not found\n", "text/plain; charset=utf-8", method);
      return;
    }
    const [file, contentType] = route;
    const path = join(siteRoot, file);
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error("not a regular file");
      response.writeHead(200, {
        ...securityHeaders,
        "Content-Type": contentType,
        "Content-Length": info.size,
        "Cache-Control": file === "index.html" ? "no-store" : "public, max-age=300",
      });
      if (method === "HEAD") {
        response.end();
      } else {
        const stream = createReadStream(path);
        stream.on("error", () => { response.destroy(); });
        stream.pipe(response);
      }
    } catch {
      if (!response.headersSent) send(response, 503, "Static content unavailable\n", "text/plain; charset=utf-8", method);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = process.env.TIGERIQ_SHOWCASE_PORT || String(defaultPort);
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    process.stderr.write("INVALID_TIGERIQ_SHOWCASE_PORT\n");
    process.exitCode = 2;
  } else {
    const server = createShowcaseServer();
    server.requestTimeout = 10000;
    server.headersTimeout = 12000;
    server.listen(port, bindingHost, () => {
      process.stdout.write("TIGERIQ_SHOWCASE_READY http://" + bindingHost + ":" + port + "\n");
    });
    server.on("error", (error) => {
      process.stderr.write("TIGERIQ_SHOWCASE_BIND_ERROR " + error.code + "\n");
      process.exitCode = 1;
    });
    process.once("SIGTERM", () => server.close());
    process.once("SIGINT", () => server.close());
  }
}
