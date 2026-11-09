import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fixtureChildEnvironment } from '../benchmarks/cline-executor-eval/harness.mjs';

test('without a fixture root host profile and temp paths are omitted',()=>{
  const env=fixtureChildEnvironment({
    PATH:'/bin',SystemRoot:'C:\\Windows',
    HOME:'/host/home',USERPROFILE:'C:\\Users\\owner',APPDATA:'host-app',
    LOCALAPPDATA:'host-local',TEMP:'host-temp',TMP:'host-tmp',TMPDIR:'host-tmpdir'
  });
  assert.equal(env.PATH,'/bin');
  assert.equal(env.SystemRoot,'C:\\Windows');
  for(const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR'])
    assert.equal(env[key],undefined);
});

test('absolute disposable fixture root replaces every profile and temp path',()=>{
  const root=path.resolve(os.tmpdir(),'tigeriq-4532-private-fixture');
  const env=fixtureChildEnvironment({PATH:'/bin',HOME:'/host',TEMP:'/host-temp'},root);
  for(const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR'])
    assert.equal(env[key],root);
});

test('credential and node injection variables never cross into fixture tests',()=>{
  const root=path.resolve(os.tmpdir(),'tigeriq-4532-private-fixture');
  const env=fixtureChildEnvironment({
    PATH:'/bin',GITHUB_TOKEN:'x',TIGERIQ_GITHUB_TOKEN:'x',OPENAI_API_KEY:'x',
    OLLAMA_API_KEY:'x',DATABASE_URL:'x',NODE_OPTIONS:'--require x',NODE_TEST_CONTEXT:'child-v8'
  },root);
  for(const key of ['GITHUB_TOKEN','TIGERIQ_GITHUB_TOKEN','OPENAI_API_KEY','OLLAMA_API_KEY','DATABASE_URL','NODE_OPTIONS','NODE_TEST_CONTEXT'])
    assert.equal(env[key],undefined);
});

test('relative fixture root is rejected',()=>{
  assert.throws(()=>fixtureChildEnvironment({},'relative/workspace'),/BENCHMARK_FIXTURE_PRIVATE_ROOT_INVALID/);
});

test('filesystem root is rejected as private fixture root',()=>{
  const root=path.parse(path.resolve(os.tmpdir())).root;
  assert.throws(()=>fixtureChildEnvironment({},root),/BENCHMARK_FIXTURE_PRIVATE_ROOT_INVALID/);
});
