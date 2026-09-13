import {readdirSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=readdirSync('tests').filter(f=>f.endsWith('.test.mjs')&&/from ['"]node:test['"]/.test(readFileSync('tests/'+f,'utf8'))).map(f=>'tests/'+f);
if(!files.length)throw new Error('NODE_TEST_DISCOVERY_EMPTY');
console.log('Node test files:',files.join(', '));
const run=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
if(run.error)throw run.error;
process.exit(run.status??1);
