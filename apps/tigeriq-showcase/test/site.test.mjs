import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const css = readFileSync(resolve(root, "style.css"), "utf8");
const js = readFileSync(resolve(root, "main.js"), "utf8");
const server = readFileSync(resolve(root, "server.mjs"), "utf8");
const config = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));

test("TIG, TigerIQ, UltraCarHCM, seven service profiles", () => {
  assert.match(html, /<strong>TIG<\/strong>/);
  assert.match(html, />TigerIQ<\/span>/);
  assert.match(html, /UltraCarHCM/);
  assert.match(html, /0392960003/);
  assert.equal((html.match(/class="service-card reveal"/g) || []).length, 7);
  assert.equal((html.match(/class="service-detail-item"/g) || []).length, 7);
  for (const label of ["Thiết kế Website","Phần mềm","UltraCarHCM","Driver","In 3D","Marketing","PhoneFarm"]) assert.ok(html.includes(label),label);
});
test("Real direct Zalo and separate published News website", () => {
  assert.match(html, /https:\/\/zalo\.me\/0392960003/);
  assert.match(html, /https:\/\/news\.tigeriq\.io\.vn\/vi/);
  assert.match(html, /id="brief-form"/);
  assert.match(html, /id="copy-brief"/);
  assert.match(html, /id="brief-output"/);
  assert.match(js, /navigator\.clipboard\.writeText/);
  assert.match(html, /class="faq-item reveal"/);
  assert.doesNotMatch(html, /href="#contact">Tìm hiểu/);
});
test("No repository, source API, secrets or unverified sales claims in public assets", () => {
  assert.doesNotMatch(html + css + js + server, /github|api\.github|ghp_|private_key|pc01\.tail/i);
  assert.doesNotMatch(html, /500\+|300\+|5\+\s*năm|xem video/i);
  assert.match(html, /ĐANG PHÁT TRIỂN VÀ KIỂM THỬ/);
  assert.doesNotMatch(js, /fetch\(/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
});
test("Animated, accessible, keyboard and reduced motion controls", () => {
  assert.match(css, /@keyframes ringOrbit/);
  assert.match(css, /@keyframes driftTrack/);
  assert.match(css, /prefers-reduced-motion:reduce/i);
  assert.match(css, /body\.motion-off/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /Roboto Flex/);
  assert.match(html, /aria-controls="site-nav"/);
  assert.match(html, /id="motion-toggle"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /pointermove/);
  assert.match(js, /requestAnimationFrame/);
});
test("PC01 and static host security & SEO", () => {
  assert.equal(config.framework, null);
  const csp = config.headers[0].headers.find((x) => x.key === "Content-Security-Policy")?.value;
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|github/);
  assert.match(server, /connect-src 'self'/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /\/favicon\.svg/);
  assert.match(readFileSync(resolve(root,"robots.txt"),"utf8"), /sitemap\.xml/);
  assert.match(readFileSync(resolve(root,"sitemap.xml"),"utf8"), /tigeriq\.io\.vn/);
  assert.ok(html.includes("/style.css?v=tig-v3-20261105"));
  assert.ok(html.includes("/main.js?v=tig-v3-20261105"));
});
