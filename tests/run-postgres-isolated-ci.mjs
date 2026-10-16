// GitHub-hosted Ubuntu PostgreSQL test: no external DB or credentials.
// Create one peer-auth role and one disposable DB on this ephemeral runner.
// Run tests as the existing checkout user (not as postgres, whose account
// cannot traverse GitHub's private checkout tree).
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {userInfo} from 'node:os';

const githubHosted=process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_OS==='Linux'&&
  process.env.RUNNER_ENVIRONMENT==='github-hosted';
if(!githubHosted){
  console.log('G4_POSTGRES_NOT_RUN: GitHub-hosted Ubuntu runner unavailable');
  process.exit(0);
}
const peerUser=userInfo().username;
if(peerUser!=='runner')throw Error('G4_POSTGRES_UNEXPECTED_OS_USER');
const db='tigeriq_test_'+randomBytes(6).toString('hex');
const run=(args,{timeout=15000,stdio='inherit'}={})=>execFileSync('sudo',['-n',...args],{
  cwd:process.cwd(),timeout,stdio,env:process.env
});
let roleCreated=false,created=false,passed=false;
try{
  run(['systemctl','start','postgresql.service'],{timeout:25000});
  run(['-u','postgres','createuser','--no-superuser','--no-createdb','--no-createrole','--login',peerUser]);
  roleCreated=true;
  run(['-u','postgres','createdb','--owner='+peerUser,db]);
  created=true;
  console.log('G4_POSTGRES_ISOLATED_DB_CREATED '+db);
  execFileSync(process.execPath,['--test','tests/coding-postgres-integration.test.mjs'],{
    cwd:process.cwd(),timeout:120000,stdio:'inherit',
    env:{...process.env,
      TIGERIQ_TEST_POSTGRES_DB:db,
      TIGERIQ_TEST_POSTGRES_SOCKET:'/var/run/postgresql',
      TIGERIQ_TEST_POSTGRES_USER:peerUser
    }
  });
  passed=true;
}finally{
  if(created){
    try{run(['-u','postgres','dropdb','--if-exists',db],{timeout:20000})}
    catch(error){console.error('G4_POSTGRES_TEST_DB_CLEANUP_FAILED');throw error}
  }
  if(roleCreated){
    try{run(['-u','postgres','dropuser',peerUser],{timeout:20000})}
    catch(error){console.error('G4_POSTGRES_TEST_ROLE_CLEANUP_FAILED');throw error}
  }
}
if(!passed)throw Error('G4_POSTGRES_REAL_TEST_FAILED');
console.log('G4_POSTGRES_REAL_TEST_PASSED_DB_AND_ROLE_DROPPED');
