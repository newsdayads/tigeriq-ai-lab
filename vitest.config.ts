import { defineConfig } from 'vitest/config';
import {readdirSync,readFileSync} from 'node:fs';

const nodeTests=readdirSync('tests')
  .filter(f=>f.endsWith('.test.mjs')&&/from ['"]node:test['"]/.test(readFileSync('tests/'+f,'utf8')))
  .map(f=>'tests/'+f);
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    exclude: nodeTests,
    environment: 'node'
  }
});
