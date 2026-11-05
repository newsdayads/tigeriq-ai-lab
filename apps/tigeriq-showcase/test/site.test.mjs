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

test("TIG is the sole abbreviation, TigerIQ full brand and correct hotline", () => {
  assert.match(html, /<strong>TIG<\/strong>/);
  assert.match(html, />TigerIQ<\/span>/);
  assert.doesNotMatch(html, /\bTQ\b/);
  assert.match(html, /tel:0392960003/);
  assert.match(html, /0392960003/);
});
test("Seven services with UltraCarHCM exactly", () => {
  for (const name of ["Thiết kế Website","Phần mềm","UltraCarHCM","Driver","In 3D","Marketing","PhoneFarm"]) {
    assert.ok(html.includes(name), "Missing " + name);
  }
  assert.equal((html.match(/class="service-card reveal"/g) || []).length, 7);
  assert.doesNotMatch(html, /<h3>UltraCar<\/h3>/);
});
test("Approved minimal light design, thin readable font, responsive and reduced motion", () => {
  assert.match(css, /--paper:#faf9fc/);
  assert.match(css, /--red:#d7132a/);
  assert.match(css, /Roboto Flex/);
  assert.match(css, /font-weight:350/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(html, /<html lang="vi">/);
  assert.match(html, /class="tig-illustration"/);
  assert.match(html, /Công nghệ thực tế/);
  assert.match(html, /Giá trị bền vững/);
});
test("No fake metrics or unactionable video", () => {
  assert.doesNotMatch(html, /500\+|300\+|5\+\s*năm|xem video/i);
  assert.doesNotMatch(html + js, /pc01\.tail|api\/health-view|private_key|ghp_/i);
  assert.doesNotMatch(js, /innerHTML\s*=/);
  assert.match(html, /ĐANG PHÁT TRIỂN &amp; KIỂM THỬ|ĐANG PHÁT TRIỂN & KIỂM THỬ/);
  assert.match(js, /repo\.private === false/);
  assert.match(js, /tigeriq-public-showcase/);
});
test("Actual mobile menu with accessible button, public safe CSP", () => {
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="site-nav"/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /menu\.addEventListener\("click"/);
  assert.equal(config.framework, null);
  const csp = config.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /connect-src 'self' https:\/\/api\.github\.com/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.ok(html.includes("/style.css") && html.includes("/main.js"));
});
