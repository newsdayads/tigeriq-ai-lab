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
it('C02: no bounds readback means NOT_MEASURED, not PASS',()=>{
  const b={x:1,y:2,width:100,height:100};
  expect(checkAppliedBounds({requested_bounds:b,observed_bounds:b}).status).toBe('NOT_MEASURED');
  expect(checkAppliedBounds({requested_bounds:b,observed_bounds:{...b,x:4},evidence_ref:'fixture:readback'}).status).toBe('BOUNDS_DIFFER_OBSERVED');
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
