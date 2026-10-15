import test from 'node:test';
import assert from 'node:assert/strict';
import {computePpeScenario, R10_ECONOMICS_SCOPE, APIFY_PPE_COMPUTE_RATE_USD} from './r10-economics.mjs';

const base = Object.freeze({
  pricingModel: 'PPE_ONLY', actorUsesStandbyMode: false,
  customerTier: 'BRONZE', eventPriceUsd: '0.01',
  computeUnits: '0', nonCuPlatformCostUsd: '0',
});
const run = overrides => computePpeScenario({...base,...overrides});

test('hypothetical status is explicit; no actual billing or customer revenue is claimed', () => {
  const result=run();
  assert.equal(result.evidenceStatus,R10_ECONOMICS_SCOPE);
  assert.equal(result.verifiedActualApifyUsage,false);
  assert.equal(result.verifiedActualPaidRevenue,false);
  assert.equal(result.commercialDecisionReady,false);
  assert.equal(Object.isFrozen(result),true);
});
test('Bronze PPE $0.01: developer share is 80%, $0.20/CU',()=>{
  const x=run();
  assert.equal(x.developerShareUsd,'0.008000000');
  assert.equal(x.platformCuRateUsd,'0.20');
  assert.equal(x.profitUsdAssumed,'0.008000000');
  assert.equal(x.profitMarginOnDeveloperShare,'1.000000');
});
test('three documented price scenarios have exact break-even and 30% margin CU caps',()=>{
  for(const [price,breakEven,at30] of [
    ['0.01','0.040000000','0.028000000'],
    ['0.02','0.080000000','0.056000000'],
    ['0.03','0.120000000','0.084000000']
  ]){
    const x=run({eventPriceUsd:price});
    assert.equal(x.breakEvenComputeUnitsAtAssumedNonCuCost,breakEven);
    assert.equal(x.maxComputeUnitsFor30PctDeveloperMargin,at30);
  }
});
test('at break-even CU, profits are zero',()=>{
  const x=run({computeUnits:'0.04'});
  assert.equal(x.totalPlatformCostUsdAssumed,'0.008000000');
  assert.equal(x.profitUsdAssumed,'0.000000000');
  assert.equal(x.profitMarginOnDeveloperShare,'0.000000');
});
test('above break-even, modeled profits and margin are negative',()=>{
  const x=run({computeUnits:'0.05'});
  assert.equal(x.profitUsdAssumed,'-0.002000000');
  assert.equal(x.profitMarginOnDeveloperShare,'-0.250000');
});
test('30%-margin budget is relative to developer proceeds, not customer gross revenue',()=>{
  const x=run({computeUnits:'0.028'});
  assert.equal(x.profitUsdAssumed,'0.002400000');
  assert.equal(x.profitMarginOnDeveloperShare,'0.300000');
});
test('non-CU costs are included, reducing thresholds rather than silently disappearing',()=>{
  const x=run({nonCuPlatformCostUsd:'0.002'});
  assert.equal(x.totalPlatformCostUsdAssumed,'0.002000000');
  assert.equal(x.breakEvenComputeUnitsAtAssumedNonCuCost,'0.030000000');
  assert.equal(x.maxComputeUnitsFor30PctDeveloperMargin,'0.018000000');
});
test('negative remaining CU budget produces null rather than false zero or fake capacity',()=>{
  const x=run({nonCuPlatformCostUsd:'0.007'});
  assert.equal(x.breakEvenComputeUnitsAtAssumedNonCuCost,'0.005000000');
  assert.equal(x.maxComputeUnitsFor30PctDeveloperMargin,null);
});
test('no remaining budget at zero CU returns break-even capacity zero',()=>{
  const x=run({nonCuPlatformCostUsd:'0.008'});
  assert.equal(x.breakEvenComputeUnitsAtAssumedNonCuCost,'0.000000000');
  assert.equal(x.maxComputeUnitsFor30PctDeveloperMargin,null);
});
test('tier rates are explicit: SILVER and GOLD are not priced at BRONZE rate',()=>{
  assert.deepEqual(APIFY_PPE_COMPUTE_RATE_USD,{BRONZE:'0.20',SILVER:'0.16',GOLD:'0.13'});
  assert.equal(run({customerTier:'SILVER',computeUnits:'1'}).computeCostUsdAssumed,'0.160000000');
  assert.equal(run({customerTier:'GOLD',computeUnits:'1'}).computeCostUsdAssumed,'0.130000000');
});
test('free-tier runs contribute no modeled paid developer revenue or platform expense',()=>{
  const x=run({customerTier:'FREE',eventPriceUsd:'0.1',computeUnits:'10',nonCuPlatformCostUsd:'2'});
  assert.equal(x.developerShareUsd,'0.000000000');
  assert.equal(x.totalPlatformCostUsdAssumed,'0.000000000');
  assert.equal(x.profitUsdAssumed,'0.000000000');
  assert.equal(x.profitMarginOnDeveloperShare,null);
  assert.equal(x.breakEvenComputeUnitsAtAssumedNonCuCost,null);
  assert.equal(x.platformCuRateUsd,null);
});
test('zero-price paying scenario has no ratio or invented margin',()=>{
  const x=run({eventPriceUsd:'0',computeUnits:'0'});
  assert.equal(x.profitUsdAssumed,'0.000000000');
  assert.equal(x.profitMarginOnDeveloperShare,null);
});
test('non-zero costs and zero-price tier yield loss and no positive CU capacity',()=>{
  const x=run({eventPriceUsd:'0',nonCuPlatformCostUsd:'0.1',computeUnits:'1'});
  assert.equal(x.profitUsdAssumed,'-0.300000000');
  assert.equal(x.breakEvenComputeUnitsAtAssumedNonCuCost,null);
});
test('millionth-dollar amounts and fractional CUs preserve decimal precision',()=>{
  const x=run({eventPriceUsd:'0.000001',computeUnits:'0.000003',nonCuPlatformCostUsd:'0.0000001'});
  assert.equal(x.developerShareUsd,'0.000000800');
  assert.equal(x.computeCostUsdAssumed,'0.000000600');
  assert.equal(x.profitUsdAssumed,'0.000000100');
});
test('unsupported and unverified monetization configurations fail closed',()=>{
  for(const patch of [
    {pricingModel:undefined},{pricingModel:'PAY_PER_USAGE'},
    {pricingModel:'PPE_PLUS_USAGE'},{actorUsesStandbyMode:true},
    {actorUsesStandbyMode:null},{actorUsesStandbyMode:undefined},
    {customerTier:'ENTERPRISE'},{customerTier:'BRONZE '},
  ]) assert.throws(()=>run(patch),RangeError);
});
test('missing cost assumptions reject rather than treating unknown costs as zero',()=>{
  for(const patch of [{nonCuPlatformCostUsd:undefined},{computeUnits:undefined},{eventPriceUsd:undefined}])
    assert.throws(()=>run(patch),TypeError);
});
test('invalid decimal strings, signed/negative, NaN, Infinity, scientific notation reject',()=>{
  for(const v of ['-0.1','+0.1',' 0.1','0.1 ','1e-3','Infinity',NaN,Infinity,-1,{},'0.1234567891']){
    assert.throws(()=>run({eventPriceUsd:v}),TypeError,`bad=${String(v)}`);
  }
});
test('invalid CU and non-CU assumptions reject too',()=>{
  for(const k of ['computeUnits','nonCuPlatformCostUsd'])
    for(const v of ['-1','1e2','x',null])assert.throws(()=>run({[k]:v}),TypeError);
});
test('inputs and source context remain unchanged; no mutation or I/O',()=>{
  const params=Object.freeze({...base});
  const first=computePpeScenario(params),second=computePpeScenario(params);
  assert.deepEqual(first,second);
  assert.deepEqual(params,base);
});
test('modeled cost consistently rises when CU consumption increases',()=>{
  let previous=null;
  for(let i=0;i<=100;i++){
    const x=run({computeUnits:String(i/1000)});
    const p=Number(x.profitUsdAssumed);
    if(previous!==null)assert.ok(p<=previous);
    previous=p;
  }
});

test('nano-dollar Bronze maximum CU preserves 30 percent margin after 9-place display',()=>{
  const first=run({eventPriceUsd:'0.000000001'});
  assert.equal(first.maxComputeUnitsFor30PctDeveloperMargin,'0.000000002');
  const atLimit=run({
    eventPriceUsd:'0.000000001',
    computeUnits:first.maxComputeUnitsFor30PctDeveloperMargin,
  });
  assert.ok(Number(atLimit.profitMarginOnDeveloperShare)>=0.30);
});
test('600 bounded microprice scenarios never advertise an optimistic 30%-margin CU cap',()=>{
  let accepted=0;
  for(const tier of ['BRONZE','SILVER','GOLD']){
    for(let n=1;n<=100;n++){
      const price='0.'+String(n).padStart(9,'0');
      for(const cost of ['0','0.000000001']){
        const scenario={customerTier:tier,eventPriceUsd:price,nonCuPlatformCostUsd:cost};
        const preview=run(scenario);
        const cap=preview.maxComputeUnitsFor30PctDeveloperMargin;
        if(cap===null)continue;
        accepted++;
        const atCap=run({...scenario,computeUnits:cap});
        assert.ok(Number(atCap.profitMarginOnDeveloperShare)>=0.30,
          `tier=${tier} price=${price} nonCu=${cost} cap=${cap} margin=${atCap.profitMarginOnDeveloperShare}`);
      }
    }
  }
  assert.equal(accepted,597);
});
