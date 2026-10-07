import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {computeAutonomyBenchmark,evaluateAutonomyTargets,validateAutonomyBenchmarkFixture} from '../apps/tigeriq-core/autonomy-benchmark.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/core-vnext-autonomy-baseline.json',import.meta.url),'utf8'));

test('benchmark fixture is strict and deterministic',()=>{
  const first=computeAutonomyBenchmark(fixture);
  const second=computeAutonomyBenchmark(structuredClone(fixture));
  assert.deepStrictEqual(second,first);
  assert.equal(first.scenarioId,'mixed-backlog-20-task-3-resource');
  assert.equal(first.tasksTotal,20);
  assert.equal(first.resourcesTotal,3);
});

test('benchmark computes required #4457 metrics',()=>{
  const out=computeAutonomyBenchmark(fixture);
  assert.deepStrictEqual(out.metrics.runnable_work_idle_gap_seconds.samples,[12,4,4,14]);
  assert.equal(out.metrics.runnable_work_idle_gap_seconds.p95,14);
  assert.deepStrictEqual(out.metrics.time_to_replan_seconds.samples,[4]);
  assert.equal(out.metrics.time_to_replan_seconds.p95,4);
  assert.equal(out.metrics.duplicate_dispatch_count,0);
  assert.equal(out.metrics.blocked_parent_false_park_count,0);
  assert.equal(out.metrics.restart_resume_success,1);
  assert.equal(out.metrics.owner_nudge_required_count,0);
  assert.equal(out.metrics.independent_review_violations,0);
  assert.equal(out.metrics.unsafe_plan_rejections,1);
  assert.equal(out.metrics.exact_gate_escalation_precision,1);
  assert.ok(out.metrics.resource_utilization_when_backlog_exists>0);
  assert.ok(out.metrics.resource_utilization_when_backlog_exists<=1);
  assert.ok(out.metrics.jobs_completed_per_hour>0);
});

test('target evaluator enforces the hard safety/autonomy gates',()=>{
  const result=computeAutonomyBenchmark(fixture);
  assert.equal(evaluateAutonomyTargets(result).pass,true);
  const regressed=structuredClone(result);
  regressed.metrics.duplicate_dispatch_count=1;
  assert.equal(evaluateAutonomyTargets(regressed).pass,false);
});

test('restart resume is measured instead of assumed',()=>{
  const broken=structuredClone(fixture);
  broken.events=broken.events.filter(event=>event.type!=='restart_resumed');
  const out=computeAutonomyBenchmark(broken);
  assert.equal(out.metrics.restart_resume_success,0);
  assert.equal(evaluateAutonomyTargets(out).checks.restart_resume_100pct,false);
});

test('invalid fixture fails closed',()=>{
  assert.throws(()=>validateAutonomyBenchmarkFixture({...fixture,schema:'OLD'}),/BENCHMARK_SCHEMA_INVALID/);
  const unsorted=structuredClone(fixture);
  unsorted.events[1].at='2026-10-07T11:59:59.000Z';
  assert.throws(()=>validateAutonomyBenchmarkFixture(unsorted),/BENCHMARK_EVENTS_NOT_SORTED/);
});
