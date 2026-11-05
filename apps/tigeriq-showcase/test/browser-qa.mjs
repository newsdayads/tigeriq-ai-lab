import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { createShowcaseServer } from "../server.mjs";

const root=process.env.TIGERIQ_SHOWCASE_PLAYWRIGHT_ROOT||process.cwd();
const requireRoot=createRequire(pathToFileURL(join(resolve(root),"package.json")));
const {chromium}=requireRoot("playwright");
const artifacts=process.env.TIGERIQ_SHOWCASE_QA_OUTPUT||join(process.cwd(),"tig-v3-qa");
const browserPath=process.env.TIGERIQ_SHOWCASE_BROWSER||undefined;
const server=createShowcaseServer();
await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok)});
let browser;
const reports=[];
try{
 browser=await chromium.launch({headless:true,...(browserPath?{executablePath:browserPath}:{}),args:["--no-sandbox","--disable-extensions","--disable-background-networking"]});
 await mkdir(artifacts,{recursive:true});
 for(const [label,width,height] of [["desktop",1440,900],["tablet",820,1180],["mobile",390,844],["small-mobile",320,700]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,reducedMotion:"reduce"});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const response=await page.goto("http://127.0.0.1:"+server.address().port+"/",{waitUntil:"domcontentloaded",timeout:15000});
  assert.equal(response.status(),200,label+" homepage");
  assert.equal(await page.locator(".service-card").count(),7);
  assert.equal(await page.locator(".service-detail-item").count(),7);
  assert.equal(await page.locator(".service-detail-item:visible").count(),1);
  assert.equal(await page.locator("a[href='https://zalo.me/0392960003']").count()>=4,true);
  assert.equal(await page.locator("a[href='https://news.tigeriq.io.vn/vi']").count()>=2,true);
  const metrics=await page.evaluate(()=>({
    width:document.documentElement.clientWidth,
    scroll:document.documentElement.scrollWidth,
    hero:document.querySelector("h1").getBoundingClientRect().height,
    bodyHasSource:document.documentElement.outerHTML.toLowerCase().includes("github"),
    font:getComputedStyle(document.querySelector("h1")).fontFamily,
    accent:getComputedStyle(document.documentElement).getPropertyValue("--red").trim(),
    favicon:!!document.querySelector('link[rel="icon"]')
  }));
  assert.ok(metrics.scroll<=metrics.width+2,label+" HORIZONTAL_OVERFLOW "+JSON.stringify(metrics));
  assert.ok(metrics.hero>30,label+" HERO_CLIPPED");
  assert.equal(metrics.bodyHasSource,false);
  assert.equal(metrics.accent,"#d7132a");
  assert.equal(metrics.favicon,true);
  assert.equal(await page.locator("body.motion-off").count(),1);
  const toggle=page.locator("#menu-toggle");
  if(width<=1100){
    assert.equal(await toggle.isVisible(),true,label+" menu visible");
    await toggle.click();assert.equal(await toggle.getAttribute("aria-expanded"),"true");
    assert.equal(await page.locator("#site-nav").isVisible(),true);
    await page.keyboard.press("Escape");assert.equal(await toggle.getAttribute("aria-expanded"),"false");
  }else assert.equal(await toggle.isVisible(),false);

  await page.locator(".filter-chip[data-filter='digital']").click();
  assert.equal(await page.locator(".service-card:visible").count(),2,label+" digital filter");
  await page.locator(".filter-chip[data-filter='all']").click();
  assert.equal(await page.locator(".service-card:visible").count(),7,label+" all filter");
  await page.locator('.service-open[data-service="ultracar"]').click();
  assert.equal(await page.locator('.service-detail-item[data-detail="ultracar"]:visible').count(),1);
  assert.match(await page.locator('.service-detail-item[data-detail="ultracar"] h3').innerText(),/UltraCarHCM/);
  await page.locator('a[data-brief-service="ultracar"]').click();
  assert.equal(await page.locator("#brief-service").inputValue(),"ultracar");
  await page.locator("#brief-description").fill("Tôi muốn được tư vấn giải pháp phù hợp cho xe.");
  await page.locator('#brief-form button[type="submit"]').click();
  assert.match(await page.locator("#brief-output").innerText(),/giải pháp phù hợp cho xe/);
  await page.locator("#copy-brief").click();
  const notice=await page.locator("#brief-feedback").innerText();
  assert.match(notice,/sao chép|chọn và sao chép/i);
  await page.locator(".faq-item summary").first().click();
  assert.equal(await page.locator(".faq-item").first().getAttribute("open"),"");
  assert.equal(errors.length,0,label+" JS_ERRORS "+errors.join(" | "));
  await page.screenshot({path:join(artifacts,"tig-v3-"+label+".png"),fullPage:true,animations:"disabled"});
  reports.push({label,width,height,passed:true,metrics,notice,errors});
  process.stdout.write("TIG_V3_BROWSER_QA_PASS "+label+" "+JSON.stringify(metrics)+"\n");
  await page.close();
 }
 const motionPage=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:"no-preference"});
 await motionPage.goto("http://127.0.0.1:"+server.address().port+"/",{waitUntil:"domcontentloaded"});
 const running=await motionPage.locator(".motion-track").evaluate(el=>getComputedStyle(el).animationName);
 assert.match(running,/driftTrack/);
 await motionPage.locator("#motion-toggle").click();
 assert.equal(await motionPage.locator("body.motion-off").count(),1);
 const paused=await motionPage.locator(".motion-track").evaluate(el=>getComputedStyle(el).animationName);
 assert.equal(paused,"none");
 await motionPage.close();
 await writeFile(join(artifacts,"qa-report.json"),JSON.stringify({passed:reports.length,failed:0,reports},null,2));
}finally{if(browser)await browser.close();await new Promise(done=>server.close(done))}
