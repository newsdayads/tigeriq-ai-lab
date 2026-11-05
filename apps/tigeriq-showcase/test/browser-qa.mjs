import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { createShowcaseServer } from "../server.mjs";

const frameworkRoot = process.env.TIGERIQ_SHOWCASE_PLAYWRIGHT_ROOT || process.cwd();
const requireFromRoot = createRequire(pathToFileURL(join(resolve(frameworkRoot), "package.json")));
const { chromium } = requireFromRoot("playwright");
const artifacts = process.env.TIGERIQ_SHOWCASE_QA_OUTPUT || join(dirname(new URL(import.meta.url).pathname), "screenshots");
const executablePath = process.env.TIGERIQ_SHOWCASE_BROWSER || undefined;
const server = createShowcaseServer();
await new Promise((resolveListening, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListening);
});
const origin = "http://127.0.0.1:" + server.address().port;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-extensions", "--disable-background-networking"]
  });
  await mkdir(artifacts, { recursive: true });
  for (const [label, width, height] of [["desktop",1440,900],["mobile",390,844],["small-mobile",320,700]]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce"
    });
    const runtimeErrors = [];
    page.on("pageerror", (err) => runtimeErrors.push(err.message));
    const response = await page.goto(origin + "/", { waitUntil: "domcontentloaded", timeout: 12000 });
    assert.equal(response.status(), 200);
    assert.equal(await page.locator("h1").count(), 1);
    assert.match(await page.locator("h1").innerText(), /Công nghệ thực tế/);
    assert.match(await page.locator("h1").innerText(), /Giá trị bền vững/);
    assert.equal(await page.locator(".service-card").count(), 7);
    assert.equal(await page.locator(".service-card h3").nth(2).innerText(), "UltraCarHCM");
    assert.equal(await page.locator("a[href='tel:0392960003']").count() >= 2, true);
    const metrics = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      heroHeadingWidth: document.getElementById("hero-title").getBoundingClientRect().width,
      heroHeadingHeight: document.getElementById("hero-title").getBoundingClientRect().height,
      visibleServiceCards: [...document.querySelectorAll(".service-card")].filter((el) => getComputedStyle(el).display !== "none").length
    }));
    assert.ok(metrics.pageWidth <= metrics.viewportWidth + 2, label + " HORIZONTAL_OVERFLOW " + JSON.stringify(metrics));
    assert.ok(metrics.heroHeadingHeight > 25 && metrics.heroHeadingWidth > 80, label + " HERO_CLIPPED " + JSON.stringify(metrics));
    assert.equal(metrics.visibleServiceCards, 7);
    if (width <= 780) {
      const toggle = page.locator("#menu-toggle");
      assert.equal(await toggle.isVisible(), true);
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator("#site-nav").isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    } else {
      assert.equal(await page.locator("#menu-toggle").isVisible(), false);
    }
    assert.equal(runtimeErrors.length, 0, label + " JS_PAGE_ERRORS: " + runtimeErrors.join(" | "));
    const outputFile = join(artifacts, "tig-v2-" + label + ".png");
    await page.screenshot({ path: outputFile, fullPage: true, animations: "disabled" });
    process.stdout.write("TIG_V2_BROWSER_QA_PASS " + label + " " + JSON.stringify(metrics) + " screenshot=" + outputFile + "\n");
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(() => done()));
}
