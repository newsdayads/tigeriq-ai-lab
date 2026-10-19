import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-ignore Standalone ESM source module intentionally has no TS declarations.
import { inspectG1Json } from '../../projects/dexcam-personal/g1-local-preflight.mjs';

const script=resolve('projects/dexcam-personal/g1-local-preflight.mjs');
const fixture=()=>({
  schema:'dexcam-g1-cycles-v1',capture_kind:'SYNTHETIC_FIXTURE',redaction_confirmed:true,
  cycles:Array.from({length:5},(_,i)=>({
    cycle_id:'cycle-'+i,usb_vid:0x1234,usb_pid:0xabcd,usb_interface_class:14,
    usb_present_before_R:'YES',usb_present_during_R:'YES',reverse_state:'OFF',
    R_on_evidence:'LOCAL_ONLY:on-'+i,R_off_evidence:'LOCAL_ONLY:off-'+i,
    private_log_pointer:'LOCAL_ONLY:private-log-'+i,
    R_on_timestamp:'5000',R_off_timestamp:'6000',
    R_on_clock_source:'external',R_off_clock_source:'external',
    clock_source:'android',auto_open_success:'YES',
    first_visible_live_frame_timestamp:'5500',manual_open_success:'NOT_TESTED'
  }))
});
function runFile(raw:string) {
  const dir=mkdtempSync(join(tmpdir(),'dexcam-g1-'));
  try {
    const file=join(dir,'private.json');
    writeFileSync(file,raw);
    const p=spawnSync(process.execPath,[script,file],{encoding:'utf8',timeout:8000});
    return {exit:p.status,stdout:p.stdout,stderr:p.stderr,output:JSON.parse(p.stdout)};
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
it('synthetic five-cycle JSON stays synthetic, never accepted',()=>{
  const r=runFile(JSON.stringify(fixture()));
  expect(r.exit).toBe(0);
  expect(r.output).toMatchObject({status:'SYNTHETIC_FIXTURE_ONLY',g1_accepted:false,errors:[]});
  expect(r.stderr).toBe('');
});
it('self-labelled REAL still only needs device review',()=>{
  const input=fixture();input.capture_kind='REAL_DEVICE_OBSERVATION';
  const r=runFile(JSON.stringify(input));
  expect(r.exit).toBe(0);
  expect(r.output).toMatchObject({status:'CANDIDATE_NEEDS_DEVICE_REVIEW',g1_accepted:false});
});
it('four cycles are incomplete',()=>{
  const input=fixture();input.cycles.pop();
  const r=runFile(JSON.stringify(input));
  expect(r.exit).toBe(1);
  expect(r.output.errors).toContain('cycles:FIVE_TO_100_RECORDS_REQUIRED');
});
it('duplicate cycle IDs are rejected without echoing private log references',()=>{
  const input=fixture();input.cycles[4].cycle_id=input.cycles[0].cycle_id;
  const r=runFile(JSON.stringify(input));
  expect(r.exit).toBe(1);
  expect(r.output.errors).toContain('cycles[4].cycle_id:DUPLICATE_CYCLE');
  expect(r.stdout).not.toContain('LOCAL_ONLY:private-log-0');
});
it('unknown R state remains incomplete rather than inferred OFF',()=>{
  const input=fixture();input.cycles[0].reverse_state='UNKNOWN';
  const r=runFile(JSON.stringify(input));
  expect(r.exit).toBe(1);
  expect(r.output.errors).toContain('cycles[0].reverse_state:COMPLETE_R_CYCLE_OFF_NOT_PROVEN');
});
it('invalid local evidence refs cannot leak values in output',()=>{
  const input=fixture();input.cycles[0].R_off_evidence='https://private.example/SECRET_VIN_998877';
  const r=runFile(JSON.stringify(input));
  expect(r.exit).toBe(1);
  expect(r.output.errors).toContain('cycles[0].R_off_evidence:LOCAL_ONLY_POINTER_REQUIRED');
  expect(r.stdout).not.toContain('SECRET_VIN_998877');
});
it('malformed JSON is reported without echoing private bytes',()=>{
  const r=runFile('{"SECRET_IMEI_123":"DO_NOT_DISCLOSE"');
  expect(r.exit).toBe(1);
  expect(r.output.errors).toContain('input:INVALID_JSON');
  expect(r.stdout).not.toContain('SECRET_IMEI_123');
  expect(r.stderr).toBe('');
});
it('larger than 64KB is refused without printing contents',()=>{
  const r=runFile('PRIVATE_TOKEN_'+'X'.repeat(70000));
  expect(r.exit).toBe(1);
  expect(r.output.errors).toContain('input:FILE_TOO_LARGE');
  expect(r.stdout).not.toContain('PRIVATE_TOKEN_');
});
it('argument missing returns usage error without raw path',()=>{
  const p=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:8000});
  expect(p.status).toBe(2);
  expect(JSON.parse(p.stdout).errors).toContain('input:ONE_LOCAL_JSON_PATH_REQUIRED');
});
it('nonexistent path is sanitized',()=>{
  const bad=join(tmpdir(),'NO_PRINT_DEXCAM_PRIVATE_FILE_999999');
  const p=spawnSync(process.execPath,[script,bad],{encoding:'utf8',timeout:8000});
  expect(p.status).toBe(1);
  expect(JSON.parse(p.stdout).errors).toContain('input:READ_FAILED');
  expect(p.stdout).not.toContain(bad);
  expect(p.stderr).toBe('');
});
it('import-only inspector handles invalid JSON without filesystem access',()=>{
  expect(inspectG1Json('not_json').errors).toContain('input:INVALID_JSON');
});
it('directory is refused as a regular evidence file',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dexcam-g1-directory-'));
  try {
    const p=spawnSync(process.execPath,[script,dir],{encoding:'utf8',timeout:2000});
    expect(p.status).toBe(1);
    expect(JSON.parse(p.stdout).errors).toContain('input:NOT_A_REGULAR_FILE');
  } finally {rmSync(dir,{recursive:true,force:true})}
});
it.skipIf(process.platform==='win32')('POSIX symlink alias is rejected',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dexcam-g1-symlink-'));
  try {
    const target=join(dir,'private.json'),link=join(dir,'link.json');
    writeFileSync(target,JSON.stringify(fixture()));
    symlinkSync(target,link);
    const p=spawnSync(process.execPath,[script,link],{encoding:'utf8',timeout:2000});
    expect(p.status).toBe(1);
    expect(JSON.parse(p.stdout).errors).toContain('input:NOT_A_REGULAR_FILE');
    expect(p.stdout).not.toContain(target);
  } finally {rmSync(dir,{recursive:true,force:true})}
});
const hasMkfifo=process.platform!=='win32' && spawnSync('which',['mkfifo'],{stdio:'ignore'}).status===0;
it.skipIf(!hasMkfifo)('FIFO input is rejected without waiting on an unreadable pipe',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dexcam-g1-fifo-'));
  try {
    const fifo=join(dir,'pipe');
    expect(spawnSync('mkfifo',[fifo],{encoding:'utf8',timeout:2000}).status).toBe(0);
    const p=spawnSync(process.execPath,[script,fifo],{encoding:'utf8',timeout:2000});
    expect(p.status).toBe(1);
    expect(JSON.parse(p.stdout).errors).toContain('input:NOT_A_REGULAR_FILE');
  } finally {rmSync(dir,{recursive:true,force:true})}
});
