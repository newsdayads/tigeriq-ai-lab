// GitHub-hosted Ubuntu has PostgreSQL preinstalled but stopped. Only on a
// GitHub Actions Linux runner, provision a random disposable database using
// peer auth, run the real integration suite, and drop the entire database.
// No production connection, no permanent credential or schema mutations.
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const githubHosted=process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_OS==='Linux';
if(!githubHosted){
  console.log('G4_POSTGRES_NOT_RUN: GitHub Actions Linux test runner unavailable');
  process.exit(0);
}
const db='tigeriq_test_'+randomBytes(6).toString('hex');
const run=(args,{timeout=15000,stdio='inherit'}={})=>execFileSync('sudo',['-n',...args],{
  cwd:process.cwd(),timeout,stdio,env:process.env
});
let created=false,passed=false;
try{
  run(['systemctl','start','postgresql.service'],{timeout:25000});
  run(['-u','postgres','createdb',db]);
  created=true;
  console.log('G4_POSTGRES_ISOLATED_DB_CREATED '+db);
  run(['-u','postgres','env',
    'GITHUB_ACTIONS=true','RUNNER_OS=Linux',
    'TIGERIQ_TEST_POSTGRES_SOCKET=/var/run/postgresql',
    'TIGERIQ_TEST_POSTGRES_DB='+db,
    process.execPath,'--test','tests/coding-postgres-integration.test.mjs'
  ],{timeout:120000});
  passed=true;
}finally{
  if(created){
    try{run(['-u','postgres','dropdb','--if-exists',db],{timeout:20000})}
    catch(error){console.error('G4_POSTGRES_TEST_DB_CLEANUP_FAILED');throw error}
  }
}
if(!passed)throw Error('G4_POSTGRES_REAL_TEST_FAILED');
console.log('G4_POSTGRES_REAL_TEST_PASSED_AND_DB_DROPPED');
