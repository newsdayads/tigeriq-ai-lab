import { stripTypeScriptTypes } from 'node:module';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const source = join(root, 'src');
const entries = (await readdir(source, {recursive:true})).filter((name) => name.endsWith('.ts')).sort();
if (!entries.includes('main.ts') || !entries.includes('preview.ts') || !entries.includes('render.ts')) {
  throw new Error('Required G04 source entrypoints are missing');
}
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of entries) {
  const ts = await readFile(join(source, name), 'utf8');
  const js = stripTypeScriptTypes(ts, { mode: 'strip' });
  const check = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: js, encoding: 'utf8' });
  if (check.status !== 0) throw new Error(name + ': ' + check.stderr);
  const target=join(dist, name.replace(/\.ts$/, '.js'));
  await mkdir(resolve(target, '..'), {recursive:true});
  await writeFile(target, js);
}
for (const file of ['index.html', 'styles.css']) {
  await writeFile(join(dist, file), await readFile(join(root, file)));
}
console.log('G04_BUILD_PASS files=' + (entries.length + 2) + ' output=' + dist);
