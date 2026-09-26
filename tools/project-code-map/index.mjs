import { scanProject } from './scanner.mjs';

export async function generateFileModuleMap(root) {
  const { fileMap } = await scanProject(root);
  const map = {};
  for (const [file, code] of fileMap) {
    map[file] = { size: Buffer.byteLength(code, 'utf8') };
  }
  return map;
}

export async function generateImportExportGraph(root) {
  const { importMap, exportMap } = await scanProject(root);
  const graph = { nodes: [], edges: [] };
  for (const [file, imports] of importMap) {
    graph.nodes.push(file);
    for (const imp of imports) {
      graph.edges.push({ from: file, to: imp });
    }
  }
  // Optionally include export nodes (not required for basic graph)
  return graph;
}
