import assert from 'assert';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { generateFileModuleMap, generateImportExportGraph } from '../tools/project-code-map/index.mjs';
import { scanProject } from '../tools/project-code-map/scanner.mjs';

async function withTempProject(structure, fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'proj-'));
  for (const [rel, content] of Object.entries(structure)) {
    const full = path.join(tmp, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  try {
    return await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

(async () => {
  const structure = {
    'a.js': "export const foo = 1; import { bar } from './b.js';",
    'b.js': "export const bar = 2;",
  };
  const result = await withTempProject(structure, async (root) => {
    const map = await generateFileModuleMap(root);
    const graph = await generateImportExportGraph(root);
    return { map, graph };
  });

  const mapKeys = Object.keys(result.map);
  assert.ok(mapKeys.some(p => p.endsWith('a.js')));
  assert.ok(mapKeys.some(p => p.endsWith('b.js')));

  const edge = result.graph.edges.find(e => e.from.endsWith('a.js') && e.to.endsWith('b.js'));
  assert.ok(edge, 'Import edge from a.js to b.js should exist');

  // A code map must not invent dependencies for comments or string literals.
  await withTempProject({
    'main.mjs': [
      '// import missing from "./phantom-line.mjs";',
      '/* import missing from "./phantom-block.mjs"; export const phantom = true; */',
      'const url = "https://example.org/page";',
      'const quoted = "import fake from \'./phantom-string.mjs\'; export const fake = true";',
      'const template = `import fake from "./phantom-template.mjs"`;',
      'import { real } from "./real.mjs";',
      'export const visible = real;',
    ].join('\n'),
    'real.mjs': 'export const real = true;',
  }, async (root) => {
    const { importMap, exportMap } = await scanProject(root);
    assert.deepStrictEqual(importMap.get(path.join(root, 'main.mjs')), ['./real.mjs']);
    assert.deepStrictEqual(exportMap.get(path.join(root, 'main.mjs')), ['visible']);
    const graph = await generateImportExportGraph(root);
    assert.deepStrictEqual(graph.edges.filter(e => e.from === path.join(root, 'main.mjs')).map(e => e.to), ['./real.mjs']);
  });

  // Never traverse VCS internals, dependencies or generated trees, even when
  // those directories are nested inside an otherwise indexed source folder.
  await withTempProject({
    'src/entry.js': "import { helper } from './helper.js'; export const entry = helper;",
    'src/helper.js': 'export const helper = 1;',
    'src/node_modules/hidden.js': 'export const ignored = true;',
    'node_modules/vendor/index.js': 'export const vendor = true;',
    '.git/hooks/fake.js': 'export const gitHook = true;',
    'dist/index.js': 'export const bundle = true;',
    'build/index.mjs': 'export const built = true;',
    'coverage/results.js': 'export const coverage = true;',
    '.next/build.js': 'export const nextBuild = true;',
    '.nuxt/output.js': 'export const nuxtOutput = true;',
    '.turbo/cache.js': 'export const turboCache = true;',
    '.cache/module.ts': 'export const cache = true;',
  }, async (root) => {
    const { fileMap, importMap, exportMap } = await scanProject(root);
    const indexed = [...fileMap.keys()].map(file => path.relative(root, file)).sort();
    assert.deepStrictEqual(indexed, ['src/entry.js', 'src/helper.js']);
    assert.deepStrictEqual([...importMap.keys()].sort(), [...fileMap.keys()].sort());
    assert.deepStrictEqual([...exportMap.keys()].sort(), [...fileMap.keys()].sort());
    assert.deepStrictEqual(importMap.get(path.join(root, 'src/entry.js')), ['./helper.js']);
    const graph = await generateImportExportGraph(root);
    assert.deepStrictEqual(graph.nodes.map(file => path.relative(root, file)).sort(), indexed);
  });

  // Literal dynamic imports are real dependencies; quoted and commented calls are not.
  await withTempProject({
    'entry.mjs': [
      'import { eager } from "./eager.mjs";',
      'const lazy = () => import("./lazy.mjs");',
      "const extra = () => import ( /* chunk */ './extra.mjs' );",
      'const computed = () => import(dynamicTarget);',
      'const method = obj.import("./member-fake.mjs");',
      'const quoted = "import(\\"./quoted-fake.mjs\\")";',
      'const template = `import("./template-fake.mjs")`;',
      '// import("./comment-fake.mjs");',
      '/* import("./block-fake.mjs"); */',
    ].join('\n'),
    'eager.mjs': 'export const eager = true;',
    'lazy.mjs': 'export const lazy = true;',
    'extra.mjs': 'export const extra = true;',
  }, async (root) => {
    const { importMap } = await scanProject(root);
    const entry = path.join(root, 'entry.mjs');
    const expected = ['./eager.mjs', './lazy.mjs', './extra.mjs'];
    assert.deepStrictEqual(importMap.get(entry), expected);
    const graph = await generateImportExportGraph(root);
    assert.deepStrictEqual(graph.edges.filter(edge => edge.from === entry).map(edge => edge.to), expected);
  });
  console.log('All tests passed');
})();
