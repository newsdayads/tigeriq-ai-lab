import { promises as fs } from 'fs';
import path from 'path';

export async function scanProject(root) {
  const fileMap = new Map();
  const importMap = new Map();
  const exportMap = new Map();

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(js|mjs|cjs|ts)$/.test(entry.name)) {
        const code = await fs.readFile(full, 'utf8');
        fileMap.set(full, code);
        const imports = [...code.matchAll(/import\s+(?:[^'\"]+?\s+from\s+)?['\"]([^'\"]+)['\"]/g)].map(m => m[1]);
        const exports = [...code.matchAll(/export\s+(?:default\s+)?(?:class|function|const|let|var)?\s*([A-Za-z0-9_$]*)/g)].map(m => m[1] || 'default');
        importMap.set(full, imports);
        exportMap.set(full, exports);
      }
    }
  }

  await walk(root);
  return { fileMap, importMap, exportMap };
}
