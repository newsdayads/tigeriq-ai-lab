import test from "node:test";
import assert from "node:assert/strict";
import { createShowcaseServer } from "../server.mjs";

test("PC01 loopback server exposes only public static assets and health", async () => {
 const server=createShowcaseServer();
 await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
 try{
  const address=server.address();assert.equal(address.address,"127.0.0.1");
  const base="http://127.0.0.1:"+address.port;
  const paths=["/","/style.css?v=tig-v3-20261105","/main.js?v=tig-v3-20261105","/favicon.svg","/robots.txt","/sitemap.xml","/healthz"];
  for(const path of paths){
    const response=await fetch(base+path);
    assert.equal(response.status,200,path);
    const body=await response.text();
    assert.ok(body.length>10,path);
    assert.match(response.headers.get("content-security-policy"),/connect-src 'self'/);
    assert.doesNotMatch(response.headers.get("content-security-policy"),/github/i);
    assert.equal(response.headers.get("x-content-type-options"),"nosniff");
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
