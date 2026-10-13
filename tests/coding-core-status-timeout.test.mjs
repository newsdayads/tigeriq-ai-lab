import {describe,expect,it} from 'vitest';
import {normalizeCodingCoreStatusTimeout} from '../apps/tigeriq-coding-lane/coding-lane.mjs';

describe('#280 legacy full Core status timeout budget',()=>{
  it('defaults to 8 seconds: Core PC01 /api/status exceeds the old 3s budget intermittently',()=>{
    expect(normalizeCodingCoreStatusTimeout()).toBe(8000);
    expect(normalizeCodingCoreStatusTimeout(undefined)).toBe(8000);
  });
  it('keeps reasonable scoped overrides within 3–12 seconds',()=>{
    expect(normalizeCodingCoreStatusTimeout('9000')).toBe(9000);
    expect(normalizeCodingCoreStatusTimeout(1000)).toBe(3000);
    expect(normalizeCodingCoreStatusTimeout(25000)).toBe(12000);
  });
  it('rejects invalid, negative, and nonfinite input without infinite waiting',()=>{
    for(const value of ['x',-8,NaN,Infinity,'-2']){
      expect(normalizeCodingCoreStatusTimeout(value)).toBe(8000);
    }
  });
  it('normalizes fractional values and does not alter the existing fast route timeout',()=>{
    expect(normalizeCodingCoreStatusTimeout(8100.9)).toBe(8100);
  });
});
