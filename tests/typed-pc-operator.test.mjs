import { describe, expect, it } from 'vitest';
import { parseTypedPcOperatorAction } from '../apps/tigeriq-core/typed-pc-operator.mjs';

describe('typed pc_operator fast path',()=>{
  it('accepts exactly one Owner-controlled TigerIQ task restart',()=>{
    expect(parseTypedPcOperatorAction(
      'Use exactly tigeriq_pc action=task_restart taskName="TigerIQ Core Runtime Updater".',
      {ownerDirect:true,ownerControlled:true}
    )).toEqual({action:'task_restart',taskName:'TigerIQ Core Runtime Updater',mutating:true,transport:'native_typed'});
  });
  it('allows read-only task status without mutation authority',()=>{
    expect(parseTypedPcOperatorAction(
      'tigeriq_pc action=task_status taskName="TigerIQ Core Runtime Updater"',
      {}
    )?.action).toBe('task_status');
  });
  it('fails closed for mutating task action without explicit Owner-controlled scope',()=>{
    expect(parseTypedPcOperatorAction(
      'tigeriq_pc action=task_restart taskName="TigerIQ Core Runtime Updater"',
      {ownerDirect:true,ownerControlled:false}
    )).toBeNull();
  });
  it('fails closed for multiple typed actions, non-TigerIQ tasks, or arbitrary actions',()=>{
    expect(parseTypedPcOperatorAction(
      'tigeriq_pc action=task_start taskName="TigerIQ A" and tigeriq_pc action=task_stop taskName="TigerIQ B"',
      {ownerDirect:true,ownerControlled:true}
    )).toBeNull();
    expect(parseTypedPcOperatorAction(
      'tigeriq_pc action=task_restart taskName="Windows Update"',
      {ownerDirect:true,ownerControlled:true}
    )).toBeNull();
    expect(parseTypedPcOperatorAction(
      'tigeriq_pc action=shell_exec taskName="TigerIQ Core Runtime Updater"',
      {ownerDirect:true,ownerControlled:true}
    )).toBeNull();
  });
});
