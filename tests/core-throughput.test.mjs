import test from 'node:test';
import assert from 'node:assert/strict';
import { parallelLimitFromHealthyCount } from '../apps/tigeriq-core/core-throughput-transform.mjs';

test('parallel limit is bounded by healthy resources',()=>{
  assert.equal(parallelLimitFromHealthyCount(2),3);
  assert.equal(parallelLimitFromHealthyCount(6),6);
  assert.equal(parallelLimitFromHealthyCount(12),12);
  assert.equal(parallelLimitFromHealthyCount(50),20);
});
