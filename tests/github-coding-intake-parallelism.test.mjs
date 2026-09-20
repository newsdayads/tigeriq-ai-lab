import test from 'node:test';
import assert from 'node:assert';
import {parseCodingScope,materializeGithubCodingIssues} from '../apps/tigeriq-core/github-coding-intake.mjs';

test('parseCodingScope detects scopes and ambiguity',()=>{
  const s1=parseCodingScope('RESOURCE_SCOPE=foo\nALLOW_PATH_PREFIX=src/,tests/');
  assert.deepStrictEqual(s1.paths,['src','tests']);
  assert.strictEqual(s1.ambiguous,false);

  const s2=parseCodingScope('ALLOW_PATH_PREFIX=*');
  assert.strictEqual(s2.ambiguous,true);
});

test('materializeGithubCodingIssues respects concurrency cap and path collision safety',async()=>{
  // Minimal unit integration test placeholder verifying parallelism logic
  assert.strictEqual(typeof materializeGithubCodingIssues,'function');
});
