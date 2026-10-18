/** pstack verification pilot. Read-only isolated API Health; never Core/Production acceptance. */
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,dirname,sep,join} from 'node:path';

export class VerificationBlocked extends Error{
  constructor(code,detail=''){super(detail?code+': '+detail:code);this.name='VerificationBlocked';this.code=code}
}
export function sandboxBaseUrl(raw){
  let url;
  try{url=new URL(String(raw||''))}catch{throw new VerificationBlocked('SANDBOX_URL_INVALID')}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw new VerificationBlocked('SANDBOX_URL_REQUIRES_LOOPBACK_ROOT');
  if(['3150','3210'].includes(url.port))throw new VerificationBlocked('SHARED_RUNTIME_PORT_FORBIDDEN');
  return url.origin;
}
async function readJson(url,fetchImpl){
  let response;
  try{response=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',headers:{'Cache-Control':'no-store'},signal:AbortSignal.timeout(10000)})}
  catch(error){throw new VerificationBlocked('SANDBOX_HTTP_UNREACHABLE',String(error?.message||error).slice(0,160))}
  if(!response?.ok||!(response.headers?.get?.('content-type')||'').toLowerCase().includes('application/json'))
    throw new VerificationBlocked('SANDBOX_HTTP_INVALID',url);
  try{return await response.json()}catch{throw new VerificationBlocked('SANDBOX_JSON_INVALID',url)}
}
export async function doctorAndSelectWork({baseUrl,issueNumber,fetchImpl=fetch,now=Date.now(),maxAgeMs=120000}={}){
  const origin=sandboxBaseUrl(baseUrl),number=Number(issueNumber);
  if(!Number.isSafeInteger(number)||number<1)throw new VerificationBlocked('ISSUE_NUMBER_INVALID');
  const status=await readJson(origin+'/api/status',fetchImpl);
  if(status?.ok!==true||!status.core||typeof status.core!=='object')throw new VerificationBlocked('CORE_HEALTH_NOT_VERIFIED');
  const data=await readJson(origin+'/api/health-live-work',fetchImpl),projection=data?.projection;
  if(data?.ok!==true||!projection||!Array.isArray(projection.openWork))throw new VerificationBlocked('WORK_PROJECTION_UNAVAILABLE');
  const generated=Date.parse(String(projection.generatedAt||''));
  if(!Number.isFinite(generated)||Math.abs(now-generated)>maxAgeMs||projection.stale===true||projection.workProjection?.stale===true)
    throw new VerificationBlocked('WORK_PROJECTION_STALE');
  const rows=projection.openWork.filter(row=>Number(row?.number)===number);
  if(rows.length!==1||typeof rows[0]?.title!=='string'||!rows[0].title.trim())throw new VerificationBlocked('ISSUE_NOT_UNIQUELY_VISIBLE');
  const work=rows[0];
  return {
    origin,issueNumber:number,api:{generatedAt:projection.generatedAt,health:'GET /api/status',work:'GET /api/health-live-work'},
    work:{number,title:work.title,status:String(work.status||''),jobId:String(work.jobId||''),url:String(work.url||'')},
    source:'READ_ONLY_HTTP_RESPONSE',proofScope:'SANDBOX_DIAGNOSTIC_NOT_LIVE_ACCEPTANCE'
  };
}
export async function driveWorkCard({diagnostic,browserFactory,outputDir}={}){
  if(!diagnostic?.origin||!Number.isSafeInteger(diagnostic?.issueNumber)||diagnostic.issueNumber<1||typeof browserFactory!=='function')
    throw new VerificationBlocked('DRIVE_INPUT_INVALID');
  // Recheck input before browser access. The doctor packet is not an authorization token.
  const origin=sandboxBaseUrl(diagnostic.origin+'/');
  let browser;
  try{
    browser=await browserFactory();
    const context=await browser.newContext({serviceWorkers:'block'});
    if(typeof context.route!=='function')throw new VerificationBlocked('UI_NETWORK_GUARD_UNAVAILABLE');
    let outsideRequest=false;
    // Interception denies document and subresource traffic outside the sandbox.
    // It is not a mock, nor proof of OS-level network isolation.
    await context.route('**/*',async route=>{
      const requested=route.request().url();
      let allowed=false;
      try{const u=new URL(requested);allowed=u.protocol==='http:'&&u.origin===origin;}
      catch{allowed=false}
      if(!allowed){outsideRequest=true;return route.abort('blockedbyclient')}
      return route.continue();
    });
    const page=await context.newPage();
    try{await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:15000})}
    catch(error){
      if(outsideRequest)throw new VerificationBlocked('UI_NETWORK_OUT_OF_SCOPE');
      throw error;
    }
    if(outsideRequest)throw new VerificationBlocked('UI_NETWORK_OUT_OF_SCOPE');
    if(typeof page.url!=='function'||page.url()!==origin+'/')throw new VerificationBlocked('UI_NAVIGATION_OUT_OF_SCOPE');
    const row=page.locator('.work-row[data-work-number="'+diagnostic.issueNumber+'"]');
    if(await row.count()!==1||!(await row.isVisible()))throw new VerificationBlocked('UI_WORK_CARD_NOT_VISIBLE');
    const before=(await row.innerText()).slice(0,1200);
    await row.click();
    if(outsideRequest)throw new VerificationBlocked('UI_NETWORK_OUT_OF_SCOPE');
    if(page.url()!==origin+'/')throw new VerificationBlocked('UI_NAVIGATION_OUT_OF_SCOPE');
    const backdrop=page.locator('#workDetailBackdrop');
    if(!(await backdrop.count())||!(await backdrop.getAttribute('class')||'').includes('open'))
      throw new VerificationBlocked('UI_WORK_DETAIL_NOT_OPEN');
    const after=(await page.locator('#workDetailModal').innerText()).slice(0,1800);
    const githubHref=await page.locator('#workDetailGithub').getAttribute('href').catch(()=>null);
    if(diagnostic.work.url&&githubHref!==diagnostic.work.url)throw new VerificationBlocked('UI_GITHUB_LINK_MISMATCH');
    if(outsideRequest)throw new VerificationBlocked('UI_NETWORK_OUT_OF_SCOPE');
    if(page.url()!==origin+'/')throw new VerificationBlocked('UI_NAVIGATION_OUT_OF_SCOPE');
    let screenshot=null;
    if(outputDir){screenshot=resolve(outputDir,'core-ui-work-card.png');await page.screenshot({path:screenshot,animations:'disabled'})}
    if(outsideRequest||page.url()!==origin+'/')throw new VerificationBlocked('UI_NETWORK_OUT_OF_SCOPE');
    return {action:'OPEN_WORK_CARD',before,after,githubHref:githubHref||null,screenshot,driver:'BROWSER_INTERACTION_NO_INTERCEPTION_CONFIGURED'};
  }finally{if(browser)await browser.close()}
}
export function safeEvidenceDir(raw,cwd=process.cwd()){
  if(!raw||typeof raw!=='string')throw new VerificationBlocked('EVIDENCE_DIR_REQUIRED');
  const base=resolve(cwd),allowed=resolve(base,'artifacts','pstack-verification');
  const target=resolve(base,raw),rel=relative(allowed,target);
  if(rel.startsWith('..')||rel==='..'||rel.startsWith('/')||rel==='')throw new VerificationBlocked('EVIDENCE_SCOPE_INVALID');
  // Lexical containment cannot detect pre-existing symlinks/junctions.
  try{if(realpathSync.native(base)!==base)throw new VerificationBlocked('EVIDENCE_SYMLINK_FORBIDDEN')}
  catch(e){
    if(e instanceof VerificationBlocked)throw e;
    if(e?.code!=='ENOENT')throw new VerificationBlocked('EVIDENCE_BASE_UNVERIFIED');
  }
  let cursor=base;
  for(const part of relative(base,target).split(sep)){
    cursor=join(cursor,part);
    try{
      const stat=lstatSync(cursor);
      if(stat.isSymbolicLink())throw new VerificationBlocked('EVIDENCE_SYMLINK_FORBIDDEN');
      if(!stat.isDirectory()&&cursor!==target)throw new VerificationBlocked('EVIDENCE_PARENT_NOT_DIRECTORY');
    }catch(e){
      if(e instanceof VerificationBlocked)throw e;
      if(e?.code!=='ENOENT')throw new VerificationBlocked('EVIDENCE_PATH_UNVERIFIED');
    }
  }
  return target;
}
export async function runSandboxVerification({baseUrl,issueNumber,outputDir,fetchImpl=fetch,browserFactory,now=Date.now()}={}){
  const dir=safeEvidenceDir(outputDir);
  const diagnostic=await doctorAndSelectWork({baseUrl,issueNumber,fetchImpl,now});
  await mkdir(dirname(dir),{recursive:true,mode:0o700});
  safeEvidenceDir(outputDir); // Recheck after creating the parent.
  try{await mkdir(dir,{mode:0o700})}catch(error){throw new VerificationBlocked('EVIDENCE_DIR_NOT_NEW',String(error?.code||error))}
  safeEvidenceDir(outputDir);
  const drive=await driveWorkCard({diagnostic,browserFactory,outputDir:dir});
  safeEvidenceDir(outputDir);
  const packet={version:1,product:'TigerIQ API Health Core UI',result:'SANDBOX_DIAGNOSTIC_PASS',acceptanceVerified:false,
    sourceType:'SANDBOX_READ_ONLY_UI_AND_API',time:new Date(now).toISOString(),diagnostic,drive};
  await writeFile(resolve(dir,'receipt.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
  return packet;
}
async function main(){
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined};
  const baseUrl=option('--base-url'),issueNumber=option('--issue'),outputDir=option('--evidence-dir');
  if(args.length!==6||!baseUrl||!issueNumber||!outputDir)throw new VerificationBlocked('USAGE','--base-url http://127.0.0.1:PORT/ --issue NUMBER --evidence-dir artifacts/pstack-verification/RUN');
  const {chromium}=await import('@playwright/test');
  const result=await runSandboxVerification({baseUrl,issueNumber,outputDir,browserFactory:()=>chromium.launch({headless:true,channel:'chrome'})});
  process.stdout.write(JSON.stringify({result:result.result,issue:result.diagnostic.issueNumber,evidence:outputDir,acceptanceVerified:false})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({result:'BLOCKED',code:error.code||'VERIFIER_ERROR',detail:String(error.message||error).slice(0,240)})+'\n');process.exitCode=1});
