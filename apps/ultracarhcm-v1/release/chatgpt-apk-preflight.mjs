// Read-only APK TEST gate. This module never builds, signs, copies, or schedules work.
const HEX=/^[0-9a-f]{64}$/i;
const VERSION=/^v1\.0\.(\d+)$/;
const EXPECTED_CERT='71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558';
const valid=(x)=>typeof x==='string'&&HEX.test(x);
export function validateRequest(r){
  const errors=[];
  const fail=(v,e)=>{if(!v)errors.push(e)};
  fail(r?.channel==='TEST'&&r?.productionAllowed===false,'PRODUCTION_FORBIDDEN');
  fail(r?.appId==='com.tigeriq.dexsplit','APP_ID_INVALID');
  fail(Number.isSafeInteger(r?.versionCode)&&r.versionCode>=1,'VERSION_CODE_INVALID');
  fail(VERSION.test(r?.versionLabel||''),'VERSION_LABEL_INVALID');
  fail(r?.versionName===`TigerIQ_HCM_${r?.versionLabel}`,'VERSION_NAME_INVALID');
  fail(['VERIFY_EXISTING','PREPARE_NEW'].includes(r?.mode),'MODE_INVALID');
  fail(valid(r?.expectedCert)&&r.expectedCert.toLowerCase()===EXPECTED_CERT,'CERT_PIN_INVALID');
  fail(r?.mode!=='VERIFY_EXISTING'||valid(r?.expectedSha),'SIGNED_SHA_REQUIRED');
  fail(r?.neverOverwrite===true&&r?.wildcardSelection===false&&r?.plainTextSecrets===false,'SAFETY_POLICY_INVALID');
  return {ok:errors.length===0,errors};
}
export function expectedNames(r){
  const prefix=`UltraCar_${r.versionLabel}_${r.versionCode}`;
  return {signed:`${prefix}_signed_TEST.apk`,aligned:`${prefix}_aligned_TEST.apk`};
}
export function validateExisting(r,e){
  const policy=validateRequest(r);
  if(!policy.ok)return {status:'BLOCKED',checks:{},errors:policy.errors};
  const names=expectedNames(r);
  const matches=e?.fileName===names.signed;
  const cert=String(e?.apksigner||'').match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]{64})/i)?.[1];
  const aapt=String(e?.aapt2||'').match(/package:\s+name='([^']+)'\s+versionCode='(\d+)'\s+versionName='([^']+)'/);
  const checks={
    exactName:matches,
    sha:valid(e?.sha)&&e.sha.toLowerCase()===r.expectedSha?.toLowerCase(),
    signerSuccess:/^Verifies\s*$/m.test(String(e?.apksigner||'')),
    v2:/Verified using v2 scheme[^\n]*:\s*true/i.test(String(e?.apksigner||'')),
    v3:/Verified using v3 scheme[^\n]*:\s*true/i.test(String(e?.apksigner||'')),
    cert:cert?.toLowerCase()===r.expectedCert?.toLowerCase(),
    package:aapt?.[1]===r.appId,
    code:Number(aapt?.[2])===r.versionCode,
    name:aapt?.[3]===r.versionName
  };
  return {status:Object.values(checks).every(Boolean)?'LOCAL_APK_VERIFIED':'BLOCKED',checks,cloud:'UNVERIFIED',deviceQA:'UNVERIFIED',mutationPerformed:false};
}
export function validateNewCandidate(r,e){
  const policy=validateRequest(r);
  if(!policy.ok)return {status:'BLOCKED',errors:policy.errors};
  if(r.mode!=='PREPARE_NEW')return {status:'BLOCKED',errors:['MODE_INVALID']};
  const names=expectedNames(r);
  const aapt=String(e?.aapt2||'').match(/package:\s+name='([^']+)'\s+versionCode='(\d+)'\s+versionName='([^']+)'/);
  const checks={exactName:e?.alignedFileName===names.aligned,noOverwrite:e?.signedAlreadyExists===false,alignedPresent:e?.alignedPresent===true,package:aapt?.[1]===r.appId,code:Number(aapt?.[2])===r.versionCode,name:aapt?.[3]===r.versionName};
  return {status:Object.values(checks).every(Boolean)?'PREPARE_NEW_PREFLIGHT_PASS':'BLOCKED',checks,signingPerformed:false,cloud:'UNVERIFIED',deviceQA:'UNVERIFIED'};
}
