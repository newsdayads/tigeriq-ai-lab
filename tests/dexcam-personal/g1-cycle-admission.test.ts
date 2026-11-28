import {expect,it} from 'vitest';
// @ts-ignore source-only ESM contract; no native Android/USB side effects.
import {inspectG1Cycles} from '../../projects/dexcam-personal/g1-cycle-admission.mjs';
const cycle = (i: number) => ({
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
const invalid = (x: ReturnType<typeof sample>,field: string) => {
  const result=inspectG1Cycles(x);
  expect(result.status).toBe('INCOMPLETE');
  expect(result.g1_accepted).toBe(false);
  expect(result.errors.some((e: string)=>e.startsWith(field+':'))).toBe(true);
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
it('G1 rejects a reused R ON evidence pointer across distinct cycles without leaking the pointer',()=>{
  const x=sample(); x.capture_kind='REAL_DEVICE_OBSERVATION';
  x.cycles[4].R_on_evidence=x.cycles[0].R_on_evidence;
  const r=inspectG1Cycles(x);
  expect(r.status).toBe('INCOMPLETE');
  expect(r.g1_accepted).toBe(false);
  expect(r.errors).toContain('cycles[4].R_on_evidence:REUSED_ACROSS_CYCLES');
  expect(JSON.stringify(r)).not.toContain('LOCAL_ONLY:on-1');
});
it('G1 rejects cross-cycle R OFF pointer aliasing an earlier R ON',()=>{
  const x=sample();
  x.cycles[3].R_off_evidence=x.cycles[1].R_on_evidence;
  invalid(x,'cycles[3].R_off_evidence');
  expect(inspectG1Cycles(x).errors).toContain('cycles[3].R_off_evidence:REUSED_ACROSS_CYCLES');
});
it('G1 permits one aggregate private log covering independent R observations',()=>{
  const x=sample();
  for (const row of x.cycles) row.private_log_pointer='LOCAL_ONLY:shared-aggregate-log';
  expect(inspectG1Cycles(x)).toMatchObject({
    status:'SYNTHETIC_FIXTURE_ONLY', g1_accepted:false, errors:[]
  });
});
it('no inference of R OFF from USB loss or missing actual OFF state',()=>{
  const x=sample();x.cycles[0].reverse_state='UNKNOWN';invalid(x,'cycles[0].reverse_state');
});
it('placeholders are not timestamp measurements',()=>{
  const x=sample();x.cycles[0].R_off_timestamp='NOT_MEASURED';
  invalid(x,'cycles[0].R_off_timestamp');
});
it('USB interface class must be observed, not assumed by device class',()=>{
  const x=sample();Object.assign(x.cycles[0],{usb_interface_class:'NOT_MEASURED'});
  invalid(x,'cycles[0].usb_interface_class');
});
it('auto-open YES without visible live frame is not proven',()=>{
  const x=sample();x.cycles[0].first_visible_live_frame_timestamp='NOT_MEASURED';
  invalid(x,'cycles[0].first_visible_live_frame_timestamp');
});
it('G1 rejects first live frame before independently observed R ON on a shared clock',()=>{
  const x=sample();
  x.cycles[0].clock_source=x.cycles[0].R_on_clock_source;
  x.cycles[0].first_visible_live_frame_timestamp='4999';
  const r=inspectG1Cycles(x);
  expect(r.errors).toContain('cycles[0].first_visible_live_frame_timestamp:FRAME_BEFORE_R_ON');
  expect(r.status).toBe('INCOMPLETE');
  expect(r.g1_accepted).toBe(false);
});
it('G1 rejects first live frame after independently observed R OFF on a shared clock',()=>{
  const x=sample();
  x.cycles[0].clock_source=x.cycles[0].R_off_clock_source;
  x.cycles[0].first_visible_live_frame_timestamp='6001';
  const r=inspectG1Cycles(x);
  expect(r.errors).toContain('cycles[0].first_visible_live_frame_timestamp:FRAME_AFTER_R_OFF');
  expect(r.status).toBe('INCOMPLETE');
});
it('G1 rejects a frame clock format incompatible with the same clock domain',()=>{
  const x=sample();
  x.cycles[0].clock_source=x.cycles[0].R_on_clock_source;
  x.cycles[0].first_visible_live_frame_timestamp='2026-10-20T06:10:00Z';
  expect(inspectG1Cycles(x).errors).toContain('cycles[0].first_visible_live_frame_timestamp:CLOCK_FORMAT_MISMATCH');
});
it('G1 never infers order across different frame and R clock sources',()=>{
  const x=sample();
  x.cycles[0].clock_source='android-elapsedRealtime';
  x.cycles[0].R_on_clock_source='vehicle-external-observer';
  x.cycles[0].R_off_clock_source='vehicle-external-observer';
  x.cycles[0].first_visible_live_frame_timestamp='4999';
  expect(inspectG1Cycles(x)).toMatchObject({status:'SYNTHETIC_FIXTURE_ONLY',g1_accepted:false,errors:[]});
  x.cycles[0].clock_source='vehicle-external-observer';
  x.cycles[0].first_visible_live_frame_timestamp='5500';
  expect(inspectG1Cycles(x)).toMatchObject({status:'SYNTHETIC_FIXTURE_ONLY',g1_accepted:false,errors:[]});
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
  const x=sample();x.redaction_confirmed=false;Object.assign(x,{g1_accepted:true});
  invalid(x,'redaction_confirmed');
  expect(inspectG1Cycles(x).g1_accepted).toBe(false);
});


it('G1 rejects arbitrary R timestamps, even when labeled as measured',()=>{
  const x=sample();x.cycles[0].R_on_timestamp='completely-unmeasured';
  invalid(x,'cycles[0].R_on_timestamp');
});
it('G1 rejects R OFF before R ON on the same monotonic clock',()=>{
  const x=sample();x.cycles[0].R_off_timestamp='4999';
  invalid(x,'cycles[0].R_off_timestamp');
});
it('G1 rejects imaginary first-visible-live-frame timestamps',()=>{
  const x=sample();x.cycles[0].first_visible_live_frame_timestamp='yesterday';
  invalid(x,'cycles[0].first_visible_live_frame_timestamp');
});
it('G1 accepts valid RFC3339 dates with an explicit offset as structural timestamps',()=>{
  const x=sample();
  x.cycles[0].R_on_timestamp='2026-10-20T05:00:00+07:00';
  x.cycles[0].R_off_timestamp='2026-10-20T05:00:01+07:00';
  expect(inspectG1Cycles(x)).toMatchObject({status:'SYNTHETIC_FIXTURE_ONLY',g1_accepted:false,errors:[]});
  x.cycles[0].R_off_timestamp='2026-10-20T04:59:59+07:00';
  invalid(x,'cycles[0].R_off_timestamp');
});
it('G1 rejects invalid calendar dates and offsets',()=>{
  const x=sample();x.cycles[0].R_on_timestamp='2026-02-30T05:00:00+07:00';
  invalid(x,'cycles[0].R_on_timestamp');
  x.cycles[0].R_on_timestamp='2026-10-20T05:00:00+25:00';
  invalid(x,'cycles[0].R_on_timestamp');
});
it('G1 does not compare events across unverified clock domains',()=>{
  const x=sample();
  x.cycles[0].R_on_clock_source='observer-timer-A';
  x.cycles[0].R_off_clock_source='observer-timer-B';
  x.cycles[0].R_off_timestamp='4999';
  expect(inspectG1Cycles(x)).toMatchObject({status:'SYNTHETIC_FIXTURE_ONLY',g1_accepted:false,errors:[]});
});
it('G1 rejects mixed timestamp formats on the same declared clock',()=>{
  const x=sample();x.cycles[0].R_on_timestamp='2026-10-20T05:00:00Z';
  invalid(x,'cycles[0].R_off_timestamp');
});
