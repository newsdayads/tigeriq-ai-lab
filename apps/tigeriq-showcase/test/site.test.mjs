import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const css = readFileSync(resolve(root, "style.css"), "utf8");
const js = readFileSync(resolve(root, "main.js"), "utf8");
const config = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
test("TigerIQ brand and correct hotline", () => {
  assert.match(html, /Tiger<span>IQ<\/span>/);
  assert.match(html, /tel:0392960003/);
  assert.match(html, /0392 960 003/);
});
test("All seven requested service areas present", () => {
  for (const name of ["Thiết kế Website", "Phần mềm", "UltraCar", "Driver", "In 3D", "Marketing", "PhoneFarm"]) {
    assert.ok(html.includes(name) && js.includes(name), "Missing: " + name);
  }
  assert.equal((html.match(/class="service-option/g) || []).length, 7);
});
test("Thin font, Vietnamese and reduced motion", () => {
  assert.match(css, /Roboto Flex/);
  assert.match(css, /font-weight:3[0345]0/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(html, /lang="vi"/);
  assert.match(html, /aria-expanded="false"/);
});
test("No internal secrets or fabricated production statements", () => {
  assert.doesNotMatch(html + js, /pc01\.tail|api\/health-view|bearer\s|private_key|ghp_/i);
  assert.match(html, /ĐANG PHÁT TRIỂN \/ KIỂM THỬ/);
  assert.match(js, /repo\.private === false/);
  assert.match(js, /repo\.topics\.includes\("tigeriq-public-showcase"\)/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
});
test("Isolated deployment and public-only GitHub sync", () => {
  assert.equal(config.framework, null);
  assert.equal(config.git.deploymentEnabled, true);
  const csp = config.headers[0].headers.find(h => h.key === "Content-Security-Policy").value;
  assert.match(csp, /connect-src 'self' https:\/\/api\.github\.com/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.ok(html.includes("/style.css") && html.includes("/main.js"));
});
