import { promises as fs } from 'fs';
import path from 'path';

// Preserve string contents (including module specifiers), while masking comments
// and remembering string offsets so an import/export *inside* a string is ignored.
function maskNonCodeImports(code) {
  const chars = code.split('');
  const quotedOffsets = new Set();
  let quote = null;
  let comment = null;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];

    if (comment === 'line') {
      if (ch === '\n' || ch === '\r') {
        comment = null;
      } else {
        chars[i] = ' ';
      }
      continue;
    }
    if (comment === 'block') {
      if (ch === '*' && next === '/') {
        chars[i] = chars[i + 1] = ' ';
        i++;
        comment = null;
      } else if (ch !== '\n' && ch !== '\r') {
        chars[i] = ' ';
      }
      continue;
    }
    if (quote) {
      quotedOffsets.add(i);
      if (ch === '\\' && i + 1 < chars.length) {
        quotedOffsets.add(++i);
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      quotedOffsets.add(i);
    } else if (ch === '/' && next === '/') {
      chars[i] = chars[i + 1] = ' ';
      i++;
      comment = 'line';
    } else if (ch === '/' && next === '*') {
      chars[i] = chars[i + 1] = ' ';
      i++;
      comment = 'block';
    }
  }
  return { sanitized: chars.join(''), quotedOffsets };
}

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
        const { sanitized, quotedOffsets } = maskNonCodeImports(code);
        fileMap.set(full, code);
        const imports = [...sanitized.matchAll(/import\s+(?:[^'\"]+?\s+from\s+)?['\"]([^'\"]+)['\"]/g)]
          .filter(m => !quotedOffsets.has(m.index))
          .map(m => m[1]);
        const exports = [...sanitized.matchAll(/export\s+(?:default\s+)?(?:class|function|const|let|var)?\s*([A-Za-z0-9_$]*)/g)]
          .filter(m => !quotedOffsets.has(m.index))
          .map(m => m[1] || 'default');
        importMap.set(full, imports);
        exportMap.set(full, exports);
      }
    }
  }

  await walk(root);
  return { fileMap, importMap, exportMap };
}
