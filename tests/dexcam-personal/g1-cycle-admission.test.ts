import {expect,it} from 'vitest';
// @ts-ignore source-only ESM contract; no native Android/USB side effects.
import {inspectG1Cycles} from '../../projects/dexcam-personal/g1-cycle-admission.mjs';
const cycle = i => ({
  cycle_id:'cycle-'+i, usb_vid:0x1234, usb_pid:0xabcd, usb_interface_class:14,
  usb_present_before_R:'YES', usb_present_during_R:'YES', reverse_state:'OFF',
  R_on_evidence:'LOCAL_ONLY:on-'+i, R_off_evidence:'LOCAL_ONLY:off-'+i,
  private_log_pointer:'LOCAL_ONLY:cycle-log-'+i,
  R_on_timestamp:'5000', R_off_timestamp:'6000',
  R_on_clock_source:'external-observation', R_off_clock_source:'external-observation',
  clock_source:'android-elapsedRealtime', auto_open_success:'YES',
  first_visible_live_frame_timestamp:'5500',manual_open_success:'NOT_TESTED'
});
const sample = () => ({
  schema:'dexcam-g1-cycles-v1',capture_kind:'SYNTHETIC_FIXTURE',
  redaction_confirmed:true,cycles:Array.from({length:5},(_,i)=>cycle(i+1))
});
const invalid = (x,field) => {
  const result=inspectG1Cycles(x);
  expect(result.status).toBe('INCOMPLETE');
  expect(result.g1_accepted).toBe(false);
  expect(result.errors.some(e=>e.startsWith(field+':'))).toBe(true);
};
it('synthetic five-cycle record remains synthetic and never G1 accepted',()=>{
  const r=inspectG1Cycles(sample());
  expect(r).toMatchObject({status:'SYNTHETIC_FIXTURE_ONLY',g1_accepted:false,errors:[]});
});
it('real-labeled records remain candidates pending private device provenance review',()=>{
  const x=sample();x.capture_kind='REAL_DEVICE_OBSERVATION';
  expect(inspectG1Cycles(x)).toMatchObject({status:'CANDIDATE_NEEDS_DEVICE_REVIEW',g1_accepted:false,errors:[]});
});
it('four cycles cannot pass structural preflight',()=>{const x=sample();x.cycles.pop();invalid(x,'cycles')});
it('duplicate cycle IDs cannot masquerade as separate R observations',()=>{
  const x=sample();x.cycles[4].cycle_id=x.cycles[0].cycle_id;invalid(x,'cycles[4].cycle_id');
});
it('R ON and OFF require distinct local evidence refs',()=>{
  const x=sample();x.cycles[1].R_off_evidence=x.cycles[1].R_on_evidence;
  invalid(x,'cycles[1].R_off_evidence');
});
it('no inference of R OFF from USB loss or missing actual OFF state',()=>{
  const x=sample();x.cycles[0].reverse_state='UNKNOWN';invalid(x,'cycles[0].reverse_state');
});
it('placeholders are not timestamp measurements',()=>{
  const x=sample();x.cycles[0].R_off_timestamp='NOT_MEASURED';
  invalid(x,'cycles[0].R_off_timestamp');
});
it('USB interface class must be observed, not assumed by device class',()=>{
  const x=sample();x.cycles[0].usb_interface_class='NOT_MEASURED';
  invalid(x,'cycles[0].usb_interface_class');
});
it('auto-open YES without visible live frame is not proven',()=>{
  const x=sample();x.cycles[0].first_visible_live_frame_timestamp='NOT_MEASURED';
  invalid(x,'cycles[0].first_visible_live_frame_timestamp');
});
it('natural auto-open failure requires same-cycle manual comparison',()=>{
  const x=sample();x.cycles[0].auto_open_success='NO';
  invalid(x,'cycles[0].manual_open_success');
  x.cycles[0].manual_open_success='NO';
  expect(inspectG1Cycles(x).status).toBe('SYNTHETIC_FIXTURE_ONLY');
});
it('auto-open YES cannot pass if USB not observed during R',()=>{
  const x=sample();x.cycles[0].usb_present_during_R='NO';
  invalid(x,'cycles[0].auto_open_success');
});
it('all error output uses stable field codes, never private evidence values',()=>{
  const x=sample();x.cycles[0].R_on_evidence='https://private.example/secret-token';
  const result=inspectG1Cycles(x);
  expect(result.status).toBe('INCOMPLETE');
  expect(JSON.stringify(result).includes('secret-token')).toBe(false);
});
it('reject missing privacy redaction and fake self-admission fields',()=>{
  const x=sample();x.redaction_confirmed=false;x.g1_accepted=true;
  invalid(x,'redaction_confirmed');
  expect(inspectG1Cycles(x).g1_accepted).toBe(false);
});
