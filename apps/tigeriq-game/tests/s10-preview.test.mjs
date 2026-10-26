import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createS10PreviewServer} from '../scripts/s10-preview.mjs';

async function withPreview(run){
  const server=createS10PreviewServer();
  await new Promise((ok,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',ok);});
  try{return await run('http://127.0.0.1:'+server.address().port);}
  finally{server.closeAllConnections?.();await new Promise(ok=>server.close(ok));}
}

test('built five-level preview serves real game entrypoint and nested local assets',async()=>{
  await withPreview(async base=>{
    const assets=['/','/index.html','/main.js','/styles.css','/engine/levels.js','/levels/draw.js'];
    for(const path of assets){
      const r=await fetch(base+path);
      assert.equal(r.status,200,path);
      assert.equal(r.headers.get('access-control-allow-origin'),null);
      assert.match(r.headers.get('content-security-policy'),/connect-src 'none'/);
      assert.ok((await r.text()).length>0,path);
    }
    const main=await (await fetch(base+'/main.js')).text();
    assert.match(main,/drawGame/);
    assert.match(main,/LEVELS/);
  });
});

test('health reports exact built index digest without pretending S10 device acceptance',async()=>{
  const hash=createHash('sha256').update(await readFile(new URL('../dist/index.html',import.meta.url))).digest('hex');
  await withPreview(async base=>{
    const r=await fetch(base+'/healthz');
    assert.equal(r.status,200);
    const p=await r.json();
    assert.equal(p.indexSha256,hash);
    assert.equal(p.previewReady,true);
    assert.equal(p.deviceLeaseVerified,false);
    assert.equal(p.nativeAdapterConnected,false);
    assert.equal(p.realDeviceAccepted,false);
    assert.equal(p.production,false);
    assert.equal(p.transport,'127.0.0.1_LOOPBACK_ONLY');
  });
});

test('traversal, query tokens, unknown files, and forbidden method never serve sensitive files',async()=>{
  await withPreview(async base=>{
    for(const path of ['/nope.js','/../package.json','/%2e%2e/package.json',
      '/main.js?token=bad','/scripts/s10-preview.mjs','/index.html%00']){
      const r=await fetch(base+path,{redirect:'manual'});
      assert.equal(r.status,404,path);
    }
    const post=await fetch(base+'/',{method:'POST'});
    assert.equal(post.status,405);
    assert.equal(post.headers.get('allow'),'GET, HEAD');
  });
});

test('HEAD serves no content and healthz stays isolated to the loopback server',async()=>{
  await withPreview(async base=>{
    for(const path of ['/','/healthz']){
      const r=await fetch(base+path,{method:'HEAD'});
      assert.equal(r.status,200);
      assert.equal(await r.text(),'');
    }
    const broken=createS10PreviewServer({distDir:'/path/never-installed-gh5284-dist'});
    await new Promise((ok,reject)=>{broken.once('error',reject);broken.listen(0,'127.0.0.1',ok);});
    try{
      const r=await fetch('http://127.0.0.1:'+broken.address().port+'/healthz');
      assert.equal(r.status,503);
      assert.equal((await r.json()).previewReady,false);
    }finally{broken.closeAllConnections?.();await new Promise(ok=>broken.close(ok));}
  });
});
