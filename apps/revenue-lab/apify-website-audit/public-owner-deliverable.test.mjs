// Offline provenance tests: no public/private requests, no credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectPublicHttpEvidence } from './public-live-smoke.mjs';
import { buildOwnerPublicDemo } from './public-owner-deliverable.mjs';

const SHA = 'a'.repeat(40);
const RUN = '39485555555';
function publicResult() {
  return {
    schemaVersion:'1.0',status:'success',requestedUrl:'https://example.com/',
    completedAt:'2026-10-21T00:00:00.000Z',
    metrics:{pagesAudited:1,errorCount:0,externalApiCostUSD:0,
      platformCostUSD:null,platformCostStatus:'pending_private_apify_run'},
    pages:[{url:'https://example.com/',statusCode:200,bytes:577,
      seo:{title:'Example Domain',metaDescription:null,h1Count:1},
      findings:[{code:'MISSING_META_DESCRIPTION',severity:'medium',
        recommendation:'Add a concise meta description for search snippets.'}]}],
    findingsSummary:{total:1,high:0,medium:1,low:0,pagesWithFindings:1},
  };
}
async function fixture() {
  // Fake HTML analysis here ONLY; the CI export still runs real HTTPS twice.
  const direct={...(await collectPublicHttpEvidence({auditFn:async()=>publicResult()})),
    verifiedSourceRevision:SHA};
  const markdown=direct.productReportMarkdown;
  const ui={
    evidenceSchema:'TIGERIQ_REVENUE_PUBLIC_UI_REAL_E2E_V1',
    evidenceClass:'REAL_PUBLIC_HTTPS_THROUGH_LOCAL_UI_BACKEND_NOT_BROWSER_CLICK_NOT_APIFY',
    sourceRevision:SHA,target:'https://example.com/',route:'POST /api/audit',
    loopbackBound:true,auditStatus:'success',pagesAudited:1,
    productReportFormat:'TIGERIQ_SEO_MARKDOWN_V1',
    reportSha256:createHash('sha256').update(markdown).digest('hex'),
    productReportMarkdown:markdown,
    issueCounts:{total:1,high:0,medium:1,low:0},
    apifyActorRan:false,apifyPlatformCostUsd:null,platformBillingVerified:false,
    externalPaidApiCostUsd:0,productWorkOrderDone:false,
  };
  return {direct,ui,sourceSha:SHA,runId:RUN};
}

test('owner result emits two verifiable Markdown reports and a bounded public proof JSON',async()=>{
  const evidence=await fixture();
  const bundle=buildOwnerPublicDemo(evidence);
  const parsed=JSON.parse(bundle.proof);
  assert.equal(parsed.sourceSha,SHA);
  assert.equal(parsed.githubRun,'https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/'+RUN);
  assert.equal(parsed.directHttp.status,200);
  assert.equal(parsed.directHttp.responseBytes,577);
  assert.equal(parsed.gates.privateActorAuthenticated,false);
  assert.equal(parsed.gates.fullWorkOrderAccepted,false);
  assert.equal(parsed.cost.apifyPlatformUsd,null);
  assert.equal(parsed.cost.externalPaidApiUsd,0);
  assert.match(bundle.ownerReport,/CHƯA XONG TOÀN BỘ/);
  assert.match(bundle.ownerReport,/MISSING_META_DESCRIPTION/);
  assert.match(bundle.ownerReport,/R04\/R05\/R06\/R07\/R08/);
  assert.ok(!bundle.proof.includes('APIFY_TOKEN'));
  const hash=s=>createHash('sha256').update(s).digest('hex');
  assert.equal(hash(evidence.ui.productReportMarkdown),parsed.localUi.reportSha256);
  assert.equal(hash(evidence.direct.productReportMarkdown),parsed.directHttp.reportSha256);
  assert.equal(bundle.uiReport,evidence.ui.productReportMarkdown+'\n');
});

test('owner result fails closed for missing/forged sha, action URL and mismatched proofs',async()=>{
  for(const patch of [
    {sourceSha:'main'}, {sourceSha:'b'.repeat(40)},
    {runId:'bad-run'}, {runId:'1;https://evil.example'},
  ]) {
    const f=await fixture();
    assert.throws(()=>buildOwnerPublicDemo({...f,...patch}),/OWNER_PUBLIC_DEMO_EVIDENCE_INVALID/);
  }
  for(const patch of [
    {ui:{sourceRevision:'b'.repeat(40)}},
    {ui:{reportSha256:'0'.repeat(64)}},
    {ui:{apifyActorRan:true}},
    {ui:{platformBillingVerified:true}},
    {ui:{loopbackBound:false}},
    {ui:{issueCounts:{total:1,high:0,medium:0,low:0}}},
    {direct:{httpStatus:503}},
    {direct:{paidRevenueVerified:true}},
    {direct:{apifyPlatformCostUsd:0}},
    {direct:{verifiedSourceRevision:null}},
  ]) {
    const f=await fixture();
    const key=Object.keys(patch)[0];
    f[key]={...f[key],...patch[key]};
    assert.throws(()=>buildOwnerPublicDemo(f),/OWNER_PUBLIC_DEMO_EVIDENCE_INVALID/);
  }
});

test('owner result refuses malformed, misleading or missing actual Markdown evidence',async()=>{
  for(const patch of [
    {direct:{productReportMarkdown:'# Fabricated landing page'}},
    {ui:{productReportMarkdown:'not-SEO-report'}},
    {direct:{productReportMarkdown:''}},
    {ui:{productReportMarkdown:'z'.repeat(12001)}},
  ]){
    const f=await fixture();
    const key=Object.keys(patch)[0];
    f[key]={...f[key],...patch[key]};
    assert.throws(()=>buildOwnerPublicDemo(f),/OWNER_PUBLIC_DEMO_EVIDENCE_INVALID/);
  }
});
