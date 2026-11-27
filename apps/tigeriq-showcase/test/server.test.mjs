import test from "node:test";
import assert from "node:assert/strict";
import { createShowcaseServer } from "../server.mjs";

test("PC01 loopback server exposes only approved public static assets and health", async () => {
 const server=createShowcaseServer();
 await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
 try{
  const address=server.address();assert.equal(address.address,"127.0.0.1");
  const base="http://127.0.0.1:"+address.port;
  const routes=[
   ["/","text/html; charset=utf-8"],
   ["/style.css?v=tig-approved-20261106","text/css; charset=utf-8"],
   ["/main.js?v=tig-v3-20261105","text/javascript; charset=utf-8"],
   ["/favicon.svg","image/svg+xml; charset=utf-8"],
   ["/approved-tig-icon.svg?v=tig-approved-20261106","image/svg+xml; charset=utf-8"],
   ["/approved-tig-logo.svg?v=tig-approved-20261106","image/svg+xml; charset=utf-8"],
   ["/robots.txt","text/plain; charset=utf-8"],
   ["/sitemap.xml","application/xml; charset=utf-8"],
   ["/healthz","application/json; charset=utf-8"]
  ];
  for(const [path,contentType] of routes){
    const response=await fetch(base+path);
    assert.equal(response.status,200,path);
    assert.equal(response.headers.get("content-type"),contentType,path);
    const body=await response.text();
    assert.ok(body.length>10,path);
    assert.match(response.headers.get("content-security-policy"),/connect-src 'self'/);
    assert.doesNotMatch(response.headers.get("content-security-policy"),/github/i);
    assert.equal(response.headers.get("x-content-type-options"),"nosniff");
    if(path.startsWith("/approved-tig-")){
      assert.ok(body.length>1_000_000,path+" source artwork unexpectedly truncated");
      assert.ok(body.includes("data:image/png;base64,iVBORw0KGgo"),path+" original PNG payload missing");
    }
  }
  const home=await(await fetch(base+"/")).text();assert.match(home,/TIG/);
  const css=await(await fetch(base+"/style.css")).text();assert.match(css,/Roboto Flex/);
  const js=await(await fetch(base+"/main.js")).text();assert.match(js,/showService/);
  const health=await(await fetch(base+"/healthz")).json();assert.deepEqual(health,{status:"ok",service:"tigeriq-showcase"});
  assert.equal((await fetch(base+"/README.md")).status,404);
  assert.equal((await fetch(base+"/../.env")).status,404);
  const method=await fetch(base+"/",{method:"POST"});assert.equal(method.status,405);assert.equal(method.headers.get("allow"),"GET, HEAD");
  const head=await fetch(base+"/",{method:"HEAD"});assert.equal(head.status,200);assert.equal(await head.text(),"");
 } finally{await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))}
});
