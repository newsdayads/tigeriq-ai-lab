import test from "node:test";
import assert from "node:assert/strict";
import { createShowcaseServer } from "../server.mjs";

test("PC01 static server binds loopback and serves only public website assets", async () => {
  const server = createShowcaseServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.equal(address.address, "127.0.0.1");
    const origin = "http://127.0.0.1:" + address.port;
    const [root, css, script, health, missing, method, hidden, head] = await Promise.all([
      fetch(origin + "/"),
      fetch(origin + "/style.css"),
      fetch(origin + "/main.js"),
      fetch(origin + "/healthz"),
      fetch(origin + "/../.env"),
      fetch(origin + "/", { method: "POST" }),
      fetch(origin + "/README.md"),
      fetch(origin + "/", { method: "HEAD" })
    ]);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /TigerIQ|Tiger<span>IQ/);
    assert.match(root.headers.get("content-security-policy"), /api\.github\.com/);
    assert.equal(root.headers.get("x-content-type-options"), "nosniff");
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /^text\/css/);
    assert.match(await css.text(), /Roboto Flex/);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /tigeriq-public-showcase/);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", service: "tigeriq-showcase" });
    assert.equal(missing.status, 404);
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "GET, HEAD");
    assert.equal(hidden.status, 404);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
