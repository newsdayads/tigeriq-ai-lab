import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parallelLimitFromHealthyCount,
  transformCoreSource,
  transformManagerJsonSource,
} from '../apps/tigeriq-core/core-throughput-transform.mjs';

test('parallel limit is bounded by healthy resources',()=>{
  assert.equal(parallelLimitFromHealthyCount(2),3);
  assert.equal(parallelLimitFromHealthyCount(6),6);
  assert.equal(parallelLimitFromHealthyCount(12),12);
  assert.equal(parallelLimitFromHealthyCount(50),20);
});

test('throughput transform matches the current Core source on LF and Windows CRLF',()=>{
  const coreSource=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  for(const source of [coreSource,coreSource.replace(/\n/g,'\r\n')]){
    const transformed=transformCoreSource(source);
    assert.match(transformed,/const MANAGER_IDLE_MS = Math\.max\(500, Number\(process\.env\.TIGERIQ_MANAGER_IDLE_MS \|\| 1000\)\);/);
    assert.match(transformed,/maxItems:MANAGER_MAX_JOBS,/);
    assert.match(transformed,/TIGERIQ_CORE_DB_POOL_MAX \|\| 12/);
    assert.match(transformed,/let liveHealthyResourceCount=3;/);
    assert.match(transformed,/liveHealthyResourceCount=Math\.max\(0,Number\(liveCapacity\)\|\|0\);/);
  }
});

test('manager JSON transform matches the current source on LF and Windows CRLF',()=>{
  const managerSource=readFileSync(new URL('../apps/tigeriq-core/manager-json.mjs',import.meta.url),'utf8');
  for(const source of [managerSource,managerSource.replace(/\n/g,'\r\n')]){
    const transformed=transformManagerJsonSource(source);
    assert.match(transformed,/const MAX_MANAGER_JOBS=Math\.max\(1,Math\.min\(6,/);
    assert.match(transformed,/value\.jobs\.length > MAX_MANAGER_JOBS/);
    assert.match(transformed,/value\.jobs\.slice\(0, MAX_MANAGER_JOBS\)/);
  }
});
