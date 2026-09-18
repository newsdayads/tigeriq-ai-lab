// @ts-nocheck
import {describe,it,expect} from 'vitest';
import {normalizeChildObjective,scopeChildObjective,dedupeChildObjectives,generateChildKey,evaluateChildState} from '../apps/tigeriq-core/work-handoff.mjs';

describe('Work handoff deterministic helpers',()=>{
  it('normalizes child objective',()=>{
    const obj=normalizeChildObjective({id:'c1',title:'Test',payload:{a:1}});
    expect(obj).toMatchObject({id:'c1',title:'Test'});
    expect(()=>normalizeChildObjective({title:'NoId'})).toThrow('CHILD_OBJECTIVE_MISSING_FIELDS');
  });
  it('scopes child under parent',()=>{
    const scoped=scopeChildObjective('PARENT', {id:'c2',title:'Child'});
    expect(scoped.scopedId).toBe('PARENT:c2');
  });
  it('dedupes by scopedId',()=>{
    const list=[{scopedId:'P:1'},{scopedId:'P:1'},{scopedId:'P:2'}];
    const uniq=dedupeChildObjectives(list);
    expect(uniq).toHaveLength(2);
  });
  it('generates deterministic child key',()=>{
    const k1=generateChildKey('OBJ','Title');
    const k2=generateChildKey('OBJ','Title');
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^CHILD-OBJ-/);
  });
  it('evaluates child state from history',()=>{
    expect(evaluateChildState({},[])).toBe('pending');
    expect(evaluateChildState({},[{status:'done'}])).toBe('complete');
  });
});
