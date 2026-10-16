import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import catalog from '../../projects/rea-reconstruction-lab/r02-tagged-upstream-license-inventory.json' with { type: 'json' };

// GH-4780: distinct post-#4920 artifact gap: bundled *nested* notices, not
// repeat acceptance of seven root LICENSE files. Only two relevant packages.
// A PR-only canary; no public network GET in merged main/repeated ordinary CI.
const SINGLE_PR_BRANCH = 'p2/4780-r02-nested-archive-notices-nv02-20261016';
const admitted = process.env.GITHUB_ACTIONS === 'true' &&
  process.env.GITHUB_HEAD_REF === SINGLE_PR_BRANCH;
const MAX_TGZ = 10 * 1024 * 1024;
const MAX_UNZIPPED = 60 * 1024 * 1024;
const MAX_ROWS = 10000;
const TARGETS = ['glob', 'pako'] as const;

function tarSize(header: Buffer) {
  const octal = header.toString('ascii').replace(/\0/g, '').trim();
  if (!/^[0-7]+$/.test(octal)) throw new Error('INVALID_TAR_SIZE');
  const size = Number.parseInt(octal, 8);
  if (!Number.isSafeInteger(size)) throw new Error('INVALID_TAR_SIZE');
  return size;
}
function readTar(blob: Buffer) {
  const bytes = gunzipSync(blob, { maxOutputLength: MAX_UNZIPPED });
  const rows: Array<{path: string; data: Buffer}> = [];
  let at=0, scanned=0;
  while (at+512<=bytes.length) {
    if (++scanned > MAX_ROWS) throw new Error('TOO_MANY_TAR_ROWS');
    const h = bytes.subarray(at,at+512);
    if (h.every(x=>x===0)) break;
    const size=tarSize(h.subarray(124,136));
    const name=h.subarray(0,100).toString('utf8').split('\0')[0];
    const prefix=h.subarray(345,500).toString('utf8').split('\0')[0];
    const path=prefix?prefix+'/'+name:name;
    const parts=path.split('/');
    if (!path.startsWith('package/') || parts.includes('..') || path.includes('\\') || path.includes('\0'))
      throw new Error('TAR_PATH_NOT_ADMITTED');
    const end=at+512+size;
    if (!Number.isSafeInteger(end) || end>bytes.length || end<at) throw new Error('TAR_TRUNCATED');
    const type=h.subarray(156,157).toString('ascii');
    if (type==='' || type==='\0' || type==='0')
      rows.push({path,data:bytes.subarray(at+512,end)});
    at+=512+Math.ceil(size/512)*512;
  }
  return rows;
}
async function readOfficialTarball(packageName: string, version: string) {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(packageName) ||
      !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('PACKAGE_PIN_INVALID');
  const url='https://registry.npmjs.org/'+packageName+'/-/'+packageName+'-'+version+'.tgz';
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
  if (!response.ok || !response.body) throw new Error('REGISTRY_HTTP_'+response.status);
  const declared=response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared)>MAX_TGZ) {
    await response.body.cancel(); throw new Error('TGZ_TOO_LARGE');
  }
  const reader=response.body.getReader();
  const chunks: Buffer[]=[];let total=0,ended=false;
  try {
    for (;;) {
      const x=await reader.read();
      if (x.done){ended=true;break;}
      total+=x.value.byteLength;
      if(total>MAX_TGZ)throw new Error('TGZ_TOO_LARGE');
      chunks.push(Buffer.from(x.value));
    }
  }finally{
    if(!ended) await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  return Buffer.concat(chunks,total);
}
function sha256(data:Buffer){return createHash('sha256').update(data).digest('hex');}
function inspect(name: string, rows: ReturnType<typeof readTar>) {
  const licenses=rows.filter(x=>/(?:^|\/)(?:LICENSE|LICENCE|COPYING|NOTICE)(?:$|[._-])/i.test(x.path));
  const info=licenses.map(x=>({path:x.path,bytes:x.data.byteLength,sha256:sha256(x.data)}));
  if(name==='glob'){
    const root=rows.find(x=>x.path==='package/LICENSE.md');
    const rootText=root?.data.toString('utf8')||'';
    const src=rows.filter(x=>x.path.startsWith('package/src/'));
    return {package:name,regularFiles:rows.length,
      rootLicenseMentionsSrcSpecificTerms:/under .?src\//i.test(rootText),
      nestedSrcFileCount:src.length,
      nestedSrcLicenseFiles:info.filter(x=>x.path.startsWith('package/src/')),
      noticeCandidates:info};
  }
  const zlib=rows.filter(x=>x.path.startsWith('package/lib/zlib/'));
  const readme=rows.find(x=>x.path.toLowerCase()==='package/readme.md');
  const text=readme?.data.toString('utf8')||'';
  return {package:name,regularFiles:rows.length,
    zlibSourceFiles:zlib.length,
    zlibSourceSample:zlib.slice(0,5).map(x=>({path:x.path,sha256:sha256(x.data)})),
    readmeFound:!!readme,
    readmeSaysMITExceptZlib:/MIT\s*-\s*all files,\s*except\s*.\/*lib\/zlib/i.test(text),
    readmeSaysZLIBFolder:/ZLIB\s*-\s*.\/*lib\/zlib/i.test(text),
    nestedZlibLicenseFiles:info.filter(x=>x.path.startsWith('package/lib/zlib/')),
    noticeCandidates:info};
}

it.runIf(admitted)('R02 two authentic published archives expose nested LICENSE/NOTICE paths and provenance',async()=>{
  const proof=[];
  for(const name of TARGETS){
    const pin=catalog.declarations.find(x=>x.path==='node_modules/'+name);
    expect(pin).toBeDefined();
    const tgz=await readOfficialTarball(name,pin!.version);
    const got='sha512-'+createHash('sha512').update(tgz).digest('base64');
    expect(got, name+' tarball bytes differ from pinned source SRI').toBe(pin!.integrity);
    const evidence={...inspect(name,readTar(tgz)),version:pin!.version,tarballBytes:tgz.length,
      tarballSRI:got,matchedOriginalLock:true};
    console.log('REA_R02_NESTED_DISTRIBUTION='+JSON.stringify(evidence));
    proof.push(evidence);
  }
  expect(proof).toHaveLength(2);
  expect(proof.every(x=>x.noticeCandidates.length>=1)).toBe(true);
},90000);

it('R02 nested-notice canary refuses to convert source proof into runtime authorization',()=>{
  expect(TARGETS).toEqual(['glob','pako']);
  expect(catalog.gates.installAuthorized).toBe(false);
  expect(catalog.gates.deviceAuthorized).toBe(false);
  expect(catalog.gates.legalDistributionApproved).toBe(false);
  expect(catalog.gates.actualConsumerSbomVerified).toBe(false);
});

it('R02 tar size parser fails closed on non-octal input',()=>{
  expect(()=>tarSize(Buffer.from('0000000010\0','ascii'))).not.toThrow();
  expect(()=>tarSize(Buffer.from('09999999\0','ascii'))).toThrow('INVALID_TAR_SIZE');
});
