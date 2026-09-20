import assert from 'assert';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { generateFileModuleMap, generateImportExportGraph } from '../tools/project-code-map/index.mjs';

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

  // Verify file map contains both files
  const mapKeys = Object.keys(result.map);
  assert.ok(mapKeys.some(p => p.endsWith('a.js')));
  assert.ok(mapKeys.some(p => p.endsWith('b.js')));

  // Verify import edge from a.js to b.js exists
  const edge = result.graph.edges.find(e => e.from.endsWith('a.js') && e.to.endsWith('b.js'));
  assert.ok(edge, 'Import edge from a.js to b.js should exist');

  console.log('All tests passed');
})();
