import test from "node:test";
import assert from "node:assert/strict";
import { createTigerIQ3DServer } from "../server.mjs";
import { once } from "node:events";
const host = "127.0.0.1";
test("TigerIQ 3D site origin serves only expected public routes", async () => {
  const server = createTigerIQ3DServer();
  server.listen(0, host);
  await once(server, "listening");
  const port = server.address().port;
  const url = "http://" + host + ":" + port;
  try {
    for (const [path, type] of [["/healthz", "application/json"], ["/", "text/html"], ["/robots.txt", "text/plain"], ["/sitemap.xml", "application/xml"]]) {
      const response = await fetch(url + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") ?? "", new RegExp(type));
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      const body = await response.text();
      if (path === "/healthz") assert.deepEqual(JSON.parse(body), { status: "ok", service: "tigeriq-3d" });
      if (path === "/") {
        assert.match(body, /TigerIQ 3D/);
        assert.match(body, /0392 960 003/);
        assert.match(body, /zalo\.me\/0392960003/);
        assert.match(body, /data-tilt/);
        assert.match(body, /prefers-reduced-motion/);
        const renderedBody = body.split("<body>")[1]?.split("</body>")[0] ?? "";
        assert.equal((renderedBody.match(/href="https:\/\/zalo\.me\/0392960003"/g) ?? []).length, 1, "one Zalo link");
        assert.equal((renderedBody.match(/href="tel:\+84392960003"/g) ?? []).length, 1, "one phone link");
        assert.equal((renderedBody.match(/0392 960 003/g) ?? []).length, 1, "phone displayed once");
        assert.equal((renderedBody.match(/class="contact-hub"/g) ?? []).length, 1, "one unified contact dock");
        assert.match(body, /@keyframes prismTurn/, "animated 3D prism");
        assert.match(body, /fx-ring-a/, "animated 3D ring");
        assert.match(body, /IntersectionObserver/, "scroll reveal");
        assert.match(body, /motion-progress/, "scroll progress");
        assert.match(body, /motion-ticker/, "continuous motion band");

      }
    }
    assert.equal((await fetch(url + "/index.html", { method: "HEAD" })).status, 200);
    assert.equal((await fetch(url + "/secret.env")).status, 404);
    assert.equal((await fetch(url + "/", { method: "POST" })).status, 405);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
