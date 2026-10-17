import {describe,expect,it} from 'vitest';
import {DEFAULT_PC01_CODING_STATUS_URL,resolveCodingStatusUrl} from '../apps/tigeriq-live-bridge/status-endpoints.mjs';

describe('PC01 Live Bridge Coding status URL',()=>{
  it('uses co-resident Coding Lane loopback bind when no override is set',()=>{
    expect(DEFAULT_PC01_CODING_STATUS_URL).toBe('http://127.0.0.1:8797/api/status');
    expect(resolveCodingStatusUrl({})).toBe(DEFAULT_PC01_CODING_STATUS_URL);
  });
  it('does not silently keep the old Tailscale default',()=>{
    expect(resolveCodingStatusUrl({})).not.toBe('http://100.97.23.87:8797/api/status');
  });
  it('preserves an explicit deployment-specific endpoint',()=>{
    expect(resolveCodingStatusUrl({TIGERIQ_CODING_STATUS_URL:'http://100.97.23.87:8797/api/status'}))
      .toBe('http://100.97.23.87:8797/api/status');
  });
  it('treats whitespace-only configuration as unset',()=>{
    expect(resolveCodingStatusUrl({TIGERIQ_CODING_STATUS_URL:'  '})).toBe(DEFAULT_PC01_CODING_STATUS_URL);
  });
});
