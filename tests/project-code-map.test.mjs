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

  console.log('All tests passed');
})();
