import {expect,it} from 'vitest';
// @ts-ignore C02 is standalone ESM used only for a source-level design contract.
import {planWindowRequest,checkAppliedBounds,planLayoutRestore} from '../../projects/dexcam-personal/c02-window-contract.mjs';
const display={id:2,fingerprint:'synthetic-monitor',width_px:1920,height_px:1080,insets:{left:0,top:40,right:0,bottom:40}};
const preset={display_id:2,display_fingerprint:'synthetic-monitor',bounds_normalized:{x:.5,y:0,width:.5,height:1}};
const capability={freeform:'SUPPORTED',multi_window:'SUPPORTED',activity_state:'FOREGROUND'};
it('C02: geometric requests do not assert Android applied bounds',()=>{
  expect(planWindowRequest({display,preset,capability})).toMatchObject({
    action:'REQUEST_L0_LAUNCH_BOUNDS',requested_bounds:{x:960,y:40,width:960,height:1000},
    applied_bounds:null,verification:'NOT_MEASURED',third_party_task_resize:'NOT_AUTHORIZED'});
});
it('C02: no OS capability or background visibility means manual fallback',()=>{
  expect(planWindowRequest({display,preset,capability:{...capability,freeform:'UNVERIFIED'}}).action).toBe('MANUAL_FALLBACK');
  expect(planWindowRequest({display,preset,capability:{...capability,activity_state:'BACKGROUND'}}).action).toBe('MANUAL_FALLBACK');
});
it('C02: display identity and normalized bounds are strictly checked',()=>{
  expect(planWindowRequest({display:{...display,id:3},preset,capability}).reason).toBe('DISPLAY_PROFILE_MISMATCH');
  expect(planWindowRequest({display,preset:{...preset,bounds_normalized:{x:.8,y:0,width:.5,height:1}},capability}).reason).toBe('INVALID_NORMALIZED_BOUNDS');
});
it('C02: invalid Android display IDs and fingerprints fail closed',()=>{
  for(const id of [-1,1.5,'2',{},NaN,Infinity]){
    const result=planWindowRequest({display:{...display,id},preset:{...preset,display_id:id},capability});
    expect(result).toMatchObject({action:'MANUAL_FALLBACK',reason:'DISPLAY_UNVERIFIED',verification:'NOT_MEASURED'});
  }
  for(const fingerprint of [' ',{},3]){
    expect(planWindowRequest({display:{...display,fingerprint},preset:{...preset,display_fingerprint:fingerprint},capability}))
      .toMatchObject({action:'MANUAL_FALLBACK',reason:'DISPLAY_UNVERIFIED'});
  }
  expect(planWindowRequest({display,preset,capability}).action).toBe('REQUEST_L0_LAUNCH_BOUNDS');
});
it('C02: no bounds readback means NOT_MEASURED, not PASS',()=>{
  const b={x:1,y:2,width:100,height:100};
  expect(checkAppliedBounds({requested_bounds:b,observed_bounds:b}).status).toBe('NOT_MEASURED');
  expect(checkAppliedBounds({requested_bounds:b,observed_bounds:{...b,x:4},evidence_ref:'fixture:readback'}).status).toBe('BOUNDS_DIFFER_OBSERVED');
});
it('C02: placeholder readback references never authenticate applied bounds',()=>{
  const bounds={x:10,y:20,width:300,height:200};
  for(const evidence_ref of ['NOT_MEASURED','  not_measured  ','UNVERIFIED','UNKNOWN','NOT_AVAILABLE','TBD','none','N/A']){
    expect(checkAppliedBounds({requested_bounds:bounds,observed_bounds:bounds,evidence_ref}))
      .toEqual({status:'NOT_MEASURED',delta:null});
  }
  expect(checkAppliedBounds({requested_bounds:bounds,observed_bounds:bounds,evidence_ref:'fixture:readback'}).status)
    .toBe('BOUNDS_MATCH_OBSERVED');
});

it('C02: loss of frame is not permission to restore while R is ON or UNKNOWN',()=>{
  for(const reverse_state of ['ON','UNKNOWN'])
    expect(planLayoutRestore({snapshot_id:'pre-R',reverse_state,live_frame:false}).restore_permitted).toBe(false);
});
it('C02: restore requires verified independent R OFF or deliberate stationary manual close',()=>{
  expect(planLayoutRestore({snapshot_id:'pre-R',reverse_state:'OFF'}).restore_permitted).toBe(false);
  expect(planLayoutRestore({snapshot_id:'pre-R',reverse_state:'OFF',reverse_off_evidence:{kind:'INDEPENDENT_R_OFF',reference:'fixture:off'}}).basis).toBe('VERIFIED_R_OFF');
  expect(planLayoutRestore({snapshot_id:'pre-R',manual_close:true}).restore_permitted).toBe(false);
  expect(planLayoutRestore({snapshot_id:'pre-R',manual_close:true,stationary_confirmed:true}).basis).toBe('MANUAL_CLOSE_WHILE_STATIONARY');
});

it('C02: R OFF with placeholder evidence must not restore the prior layout',()=>{
  for(const reference of ['NOT_MEASURED',' not_measured ','UNVERIFIED','UNKNOWN','NOT_AVAILABLE','TBD','none','N/A']){
    expect(planLayoutRestore({snapshot_id:'pre-R',reverse_state:'OFF',
      reverse_off_evidence:{kind:'INDEPENDENT_R_OFF',reference}}))
      .toEqual({action:'HOLD_AND_SHOW_CAMERA_UNAVAILABLE',restore_permitted:false,basis:'NO_VERIFIED_R_OFF'});
  }
  expect(planLayoutRestore({snapshot_id:'pre-R',reverse_state:'OFF',
    reverse_off_evidence:{kind:'INDEPENDENT_R_OFF',reference:'synthetic:off'}}).basis)
    .toBe('VERIFIED_R_OFF');
});

it('C02: odd pixel widths and heights use quantized endpoint bounds safely',()=>{
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
    expect(planWindowRequest({display:actualDisplay,preset:actualPreset,capability})).toMatchObject({
      action:'REQUEST_L0_LAUNCH_BOUNDS',requested_bounds:expected,applied_bounds:null,
      verification:'NOT_MEASURED',third_party_task_resize:'NOT_AUTHORIZED'
    });
  }
});
