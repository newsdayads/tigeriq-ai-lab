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

  // Re-export declarations are real source-module dependencies, not default
  // exports. Ignore fake re-exports in comments and quoted strings.
  await withTempProject({
    'barrel.mjs': [
      "export { foo as alias } from './named.mjs';",
      "export * from './star.mjs';",
      "export * as ns from './namespace.mjs';",
      "export type { Data } from './types.mjs';",
      'export const own = true;',
      'const fake = "export * from \'./fake-string.mjs\'";',
      'const template = `export { x } from "./fake-template.mjs"`;',
      '// export * from "./fake-comment.mjs";',
      '/* export { z } from "./fake-block.mjs"; */',
      "import './side-effect.mjs';",
    ].join('\n'),
  }, async (root) => {
    const file = path.join(root, 'barrel.mjs');
    const { importMap, exportMap } = await scanProject(root);
    assert.deepStrictEqual(importMap.get(file), [
      './named.mjs', './star.mjs', './namespace.mjs', './types.mjs', './side-effect.mjs',
    ]);
    assert.deepStrictEqual(exportMap.get(file), ['own']);
    const graph = await generateImportExportGraph(root);
    assert.deepStrictEqual(graph.edges.filter(edge => edge.from === file).map(edge => edge.to), [
      './named.mjs', './star.mjs', './namespace.mjs', './types.mjs', './side-effect.mjs',
    ]);
  });


  // Do not silently omit modern JS/TS source extensions from the code map.
  // This is independent of excluded dependency/generated directory behavior.
  await withTempProject({
    'src/index.js': "import './widget.jsx'; import './panel.tsx'; import './esm.mts'; import './common.cts';",
    'src/widget.jsx': 'export const widget = 1;',
    'src/panel.tsx': 'export const panel = 2;',
    'src/esm.mts': 'export const esm = 3;',
    'src/common.cts': 'export const common = 4;',
    'src/legacy.js': 'export const legacy = 5;',
    'src/legacy.mjs': 'export const legacyMjs = 6;',
    'src/legacy.cjs': 'export const legacyCjs = 7;',
    'src/legacy.ts': 'export const legacyTs = 8;',
    'src/skip.md': '# Not source',
    'src/node_modules/excluded.tsx': 'export const excluded = true;',
    'dist/generated.jsx': 'export const generated = true;',
  }, async (root) => {
    const expected = [
      'src/common.cts', 'src/esm.mts', 'src/index.js', 'src/legacy.cjs',
      'src/legacy.js', 'src/legacy.mjs', 'src/legacy.ts', 'src/panel.tsx', 'src/widget.jsx',
    ];
    const { fileMap, importMap, exportMap } = await scanProject(root);
    const actual = [...fileMap.keys()].map(file => path.relative(root, file)).sort();
    assert.deepStrictEqual(actual, expected);
    assert.deepStrictEqual([...importMap.keys()].sort(), [...fileMap.keys()].sort());
    assert.deepStrictEqual([...exportMap.keys()].sort(), [...fileMap.keys()].sort());
    const entry = path.join(root, 'src/index.js');
    assert.deepStrictEqual(importMap.get(entry), [
      './widget.jsx', './panel.tsx', './esm.mts', './common.cts',
    ]);
    const graph = await generateImportExportGraph(root);
    assert.deepStrictEqual(graph.nodes.map(file => path.relative(root, file)).sort(), expected);
    assert.deepStrictEqual(graph.edges.filter(edge => edge.from === entry).map(edge => edge.to), [
      './widget.jsx', './panel.tsx', './esm.mts', './common.cts',
    ]);
  });

  console.log('All tests passed');
})();
