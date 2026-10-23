import { stripTypeScriptTypes } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const entries = (await readdir(join(root, 'src'))).filter((x) => x.endsWith('.ts'));
let verified = 0;
for (const name of entries) {
  const content = await readFile(join(root, 'src', name), 'utf8');
  if (/\r|\t| +$/m.test(content) || !content.endsWith('\n')) throw new Error('Whitespace lint: ' + name);
  if (/\beval\s*\(|new\s+Function\s*\(|https?:\/\//.test(content)) throw new Error('Forbidden operation in: ' + name);
  const js = stripTypeScriptTypes(content, { mode: 'strip' });
  const check = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: js, encoding: 'utf8' });
  if (check.status !== 0) throw new Error('Syntax lint: ' + name + '\n' + check.stderr);
  verified += 1;
}
const html = await readFile(join(root, 'index.html'), 'utf8');
if (!html.includes('lang="vi"') || !html.includes('role="status"')) throw new Error('Missing accessibility attributes');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (Object.keys(pkg.dependencies ?? {}).length || Object.keys(pkg.devDependencies ?? {}).length) throw new Error('Unexpected dependency');
console.log('G04_LINT_PASS static_syntax_and_source_guards=' + verified);
