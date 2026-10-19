import test from 'node:test';
import assert from 'node:assert/strict';
import {planWindowRequest,checkAppliedBounds,planLayoutRestore} from '../../projects/dexcam-personal/c02-window-contract.mjs';
const display={id:2,fingerprint:'synthetic-monitor',width_px:1920,height_px:1080,insets:{left:0,top:40,right:0,bottom:40}};
const preset={display_id:2,display_fingerprint:'synthetic-monitor',bounds_normalized:{x:.5,y:0,width:.5,height:1}};
const capability={freeform:'SUPPORTED',multi_window:'SUPPORTED',activity_state:'FOREGROUND'};
test('C02 returns pixel request, not applied bounds',()=>{
  assert.deepEqual(planWindowRequest({display,preset,capability}).requested_bounds,{x:960,y:40,width:960,height:1000});
  assert.equal(planWindowRequest({display,preset,capability}).action,'REQUEST_L0_LAUNCH_BOUNDS');
  assert.equal(planWindowRequest({display,preset,capability}).verification,'NOT_MEASURED');
});
test('C02 freeform unverified and background launches fall back',()=>{
  assert.equal(planWindowRequest({display,preset,capability:{...capability,freeform:'UNVERIFIED'}}).action,'MANUAL_FALLBACK');
  assert.equal(planWindowRequest({display,preset,capability:{...capability,activity_state:'BACKGROUND'}}).reason,'BACKGROUND_ACTIVITY_LAUNCH_NOT_VERIFIED');
});
test('C02 rejects stale display identity, invalid ratios and unusable display',()=>{
  assert.equal(planWindowRequest({display:{...display,id:3},preset,capability}).reason,'DISPLAY_PROFILE_MISMATCH');
  for(const invalid of [{x:.8,y:0,width:.5,height:1},{x:NaN,y:0,width:1,height:1},{x:0,y:0,width:0,height:1}])
    assert.equal(planWindowRequest({display,preset:{...preset,bounds_normalized:invalid},capability}).action,'MANUAL_FALLBACK');
  assert.equal(planWindowRequest({display:{...display,insets:{left:1100,right:1100,top:0,bottom:0}},preset,capability}).reason,'NO_SAFE_DISPLAY_AREA');
});
test('C02 rejects invalid Android display IDs and unverified display fingerprints before requesting launch bounds',()=>{
  for(const id of [-1,1.5,'2',{},NaN,Infinity]){
    const result=planWindowRequest({display:{...display,id},preset:{...preset,display_id:id},capability});
    assert.equal(result.action,'MANUAL_FALLBACK','invalid Android display identity must fail closed');
    assert.equal(result.reason,'DISPLAY_UNVERIFIED');
    assert.equal(result.verification,'NOT_MEASURED');
  }
  for(const fingerprint of [' ',{},3]){
    const result=planWindowRequest({display:{...display,fingerprint},preset:{...preset,display_fingerprint:fingerprint},capability});
    assert.equal(result.action,'MANUAL_FALLBACK','empty/non-string display fingerprint must not authorize launch');
    assert.equal(result.reason,'DISPLAY_UNVERIFIED');
  }
  assert.equal(planWindowRequest({display,preset,capability}).action,'REQUEST_L0_LAUNCH_BOUNDS');
});
test('C02 does not claim bounds match without OS readback evidence',()=>{
  const bounds={x:2,y:3,width:400,height:300};
  assert.equal(checkAppliedBounds({requested_bounds:bounds,observed_bounds:bounds}).status,'NOT_MEASURED');
  assert.deepEqual(checkAppliedBounds({requested_bounds:bounds,observed_bounds:{...bounds,x:4},evidence_ref:'synthetic:readback'}),
    {status:'BOUNDS_DIFFER_OBSERVED',delta:{x:2,y:0,width:0,height:0}});
});
test('C02 treats placeholder evidence refs as NOT_MEASURED, never a bounds match',()=>{
  const bounds={x:10,y:20,width:300,height:200};
  for(const evidence_ref of ['NOT_MEASURED','  not_measured  ','UNVERIFIED','UNKNOWN','NOT_AVAILABLE','TBD','none','N/A']){
    assert.deepEqual(checkAppliedBounds({requested_bounds:bounds,observed_bounds:bounds,evidence_ref}),
      {status:'NOT_MEASURED',delta:null});
  }
  assert.equal(checkAppliedBounds({requested_bounds:bounds,observed_bounds:bounds,evidence_ref:'fixture:readback'}).status,
    'BOUNDS_MATCH_OBSERVED');
});

test('C02 does not restore on stream or USB loss while R is ON/UNKNOWN',()=>{
  for(const reverse_state of ['ON','UNKNOWN'])
    assert.equal(planLayoutRestore({snapshot_id:'snap',reverse_state,live_frame:false}).restore_permitted,false);
});
test('C02 requires independent R OFF proof, not just OFF label',()=>{
  assert.equal(planLayoutRestore({snapshot_id:'snap',reverse_state:'OFF'}).restore_permitted,false);
  assert.equal(planLayoutRestore({snapshot_id:'snap',reverse_state:'OFF',reverse_off_evidence:{kind:'INDEPENDENT_R_OFF',reference:'synthetic:r'}}).basis,'VERIFIED_R_OFF');
});
test('C02 blocks layout restore when R OFF evidence ref is a placeholder',()=>{
  for(const reference of ['NOT_MEASURED',' not_measured ','UNVERIFIED','UNKNOWN','NOT_AVAILABLE','TBD','none','N/A']){
    const result=planLayoutRestore({snapshot_id:'snap',reverse_state:'OFF',
      reverse_off_evidence:{kind:'INDEPENDENT_R_OFF',reference}});
    assert.deepEqual(result,{action:'HOLD_AND_SHOW_CAMERA_UNAVAILABLE',restore_permitted:false,basis:'NO_VERIFIED_R_OFF'});
  }
  assert.equal(planLayoutRestore({snapshot_id:'snap',reverse_state:'OFF',
    reverse_off_evidence:{kind:'INDEPENDENT_R_OFF',reference:'synthetic:off'}}).basis,'VERIFIED_R_OFF');
});

test('C02 manual close requires confirmed stationary state',()=>{
  assert.equal(planLayoutRestore({snapshot_id:'snap',manual_close:true}).restore_permitted,false);
  assert.equal(planLayoutRestore({snapshot_id:'snap',manual_close:true,stationary_confirmed:true}).basis,'MANUAL_CLOSE_WHILE_STATIONARY');
  assert.equal(planLayoutRestore({reverse_state:'OFF'}).action,'NO_SNAPSHOT');
});

test('C02 normalizes both window endpoints for odd-sized displays without a false fallback',()=>{
  const scenarios=[
    {w:1919,h:1080,insets:{left:0,right:0,top:40,bottom:40},
      r:{x:.5,y:0,width:.5,height:1},expected:{x:960,y:40,width:959,height:1000}},
    {w:1921,h:1081,insets:{left:0,right:0,top:0,bottom:0},
      r:{x:0,y:.5,width:1,height:.5},expected:{x:0,y:541,width:1921,height:540}},
    {w:1919,h:1079,insets:{left:0,right:0,top:0,bottom:0},
      r:{x:.5,y:.5,width:.5,height:.5},expected:{x:960,y:540,width:959,height:539}},
    {w:1920,h:1080,insets:{left:0,right:0,top:0,bottom:0},
      r:{x:.5,y:0,width:.5,height:1},expected:{x:960,y:0,width:960,height:1080}}
  ];
  for(const {w,h,insets,r,expected} of scenarios){
    const actualDisplay={...display,width_px:w,height_px:h,insets};
    const actualPreset={...preset,bounds_normalized:r};
    const result=planWindowRequest({display:actualDisplay,preset:actualPreset,capability});
    assert.equal(result.action,'REQUEST_L0_LAUNCH_BOUNDS',
      "valid geometric preset must not be rejected solely because of odd pixel dimensions");
    assert.deepEqual(result.requested_bounds,expected);
    assert.equal(result.applied_bounds,null);
    assert.equal(result.verification,'NOT_MEASURED');
    assert.equal(result.third_party_task_resize,'NOT_AUTHORIZED');
  }
});
