import { promises as fs } from 'fs';
import path from 'path';

// Repository metadata, installed packages and generated files are not source.
// Ignore these at every depth to keep indexes bounded and avoid phantom modules.
const IGNORED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', '.turbo', '.cache',
]);

// Preserve string contents (including module specifiers), while masking comments
// and remembering string offsets so an import/export *inside* a string is ignored.
function maskNonCodeImports(code) {
  const chars = code.split('');
  const quotedOffsets = new Set();
  let quote = null;
  let comment = null;
  let regexLiteral = false;
  let regexClass = false;
  // Each interpolation is executable JavaScript, even when its surrounding
  // template raw text is not. Depth tracks nested object/block braces safely.
  const templateExpressions = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];

    // Regex literals are data, not source declarations or imports. Mask them
    // at conservative expression-start positions without swallowing division.
    if (regexLiteral) {
      if (ch === '\\' && i + 1 < chars.length) {
        chars[i] = chars[++i] = ' ';
        continue;
      }
      if (ch === '[') regexClass = true;
      else if (ch === ']') regexClass = false;
      else if (ch === '/' && !regexClass) regexLiteral = false;
      if (ch !== '\n' && ch !== '\r') chars[i] = ' ';
      continue;
    }

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
      } else if (quote === '`' && ch === '
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
    } else if (ch === '/' && next !== '/' && next !== '*') {
      let before = i - 1;
      while (before >= 0 && /\s/.test(chars[before])) before--;
      // Only unambiguous expression starts: never classify `left / right`
      // as a RegExp. This is a lexical guard, not a full JS/TS parser.
      if (before < 0 || /[=([{:,;!?]/.test(chars[before])) {
        regexLiteral = true;
        regexClass = false;
        chars[i] = ' ';
      }
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
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(full);
        }
      } else if (/\.(?:js|jsx|mjs|mts|cjs|cts|ts|tsx)$/.test(entry.name)) {
        const code = await fs.readFile(full, 'utf8');
        const { sanitized, quotedOffsets } = maskNonCodeImports(code);
        fileMap.set(full, code);
        // Keep literal dynamic import() edges; never infer computed specifiers.
        // The sanitizer removes comments and identifies fake calls inside strings.
        const staticImports = [...sanitized.matchAll(/import\s+(?:[^'\"]+?\s+from\s+)?['\"]([^'\"]+)['\"]/g)];
        const dynamicImports = [...sanitized.matchAll(/(?<![.\w$])import\s*\(\s*(['\"])([^'\"]+)\1\s*\)/g)];
        // A re-export also depends on its source module even without "import".
        // Only literal sources are collected; comments/strings remain excluded.
        const reExports = [...sanitized.matchAll(
          /(?<![.\w$])export\s+(?:type\s+)?(?:\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?|\{[^}]*\}\s*)from\s*(['"])([^'"]+)\1/g
        )];
        // CommonJS requires are dependencies only when the specifier is a
        // literal; do not infer computed/member calls or strings/comments.
        const commonJsRequires = [...sanitized.matchAll(
          /(?<![.\w$])require\s*\(\s*(['"])([^'"]+)\1\s*\)/g
        )];
        const imports = [...staticImports, ...dynamicImports, ...reExports, ...commonJsRequires]
          .filter(m => !quotedOffsets.has(m.index))
          .sort((a, b) => a.index - b.index)
          .map(m => m[2] ?? m[1]);
        // Modifiers and TS declaration keywords are not exported symbol names.
        // Recognize async/generator functions and interface/type/enum declarations.
        const exports = [...sanitized.matchAll(
          /export\s+(?:default\s+)?(?:(?:declare|abstract|async|type|interface|enum|namespace)\s+)*(?:class|function\s*\*?|const|let|var)?\s*([A-Za-z0-9_$]*)/g
        )]
          .filter(m => !quotedOffsets.has(m.index)
            && !/^(?:type\s+)?(?:\*|\{)/.test(sanitized.slice(m.index + 6).trimStart()))
          .map(m => m[1] || 'default');
        importMap.set(full, imports);
        exportMap.set(full, exports);
      }
    }
  }

  await walk(root);
  return { fileMap, importMap, exportMap };
}
 && next === '{') {
        // Only ${...} is executable; a backslash-escaped interpolation was
        // already skipped above. Nested templates each get their own frame.
        quotedOffsets.add(++i);
        templateExpressions.push(0);
        quote = null;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (templateExpressions.length) {
      const last = templateExpressions.length - 1;
      if (ch === '{') {
        templateExpressions[last]++;
      } else if (ch === '}') {
        if (templateExpressions[last] === 0) {
          // Return to raw template text instead of treating that text as code.
          quotedOffsets.add(i);
          templateExpressions.pop();
          quote = '`';
          continue;
        }
        templateExpressions[last]--;
      }
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
    } else if (ch === '/' && next !== '/' && next !== '*') {
      let before = i - 1;
      while (before >= 0 && /\s/.test(chars[before])) before--;
      // Only unambiguous expression starts: never classify `left / right`
      // as a RegExp. This is a lexical guard, not a full JS/TS parser.
      if (before < 0 || /[=([{:,;!?]/.test(chars[before])) {
        regexLiteral = true;
        regexClass = false;
        chars[i] = ' ';
      }
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
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(full);
        }
      } else if (/\.(?:js|jsx|mjs|mts|cjs|cts|ts|tsx)$/.test(entry.name)) {
        const code = await fs.readFile(full, 'utf8');
        const { sanitized, quotedOffsets } = maskNonCodeImports(code);
        fileMap.set(full, code);
        // Keep literal dynamic import() edges; never infer computed specifiers.
        // The sanitizer removes comments and identifies fake calls inside strings.
        const staticImports = [...sanitized.matchAll(/import\s+(?:[^'\"]+?\s+from\s+)?['\"]([^'\"]+)['\"]/g)];
        const dynamicImports = [...sanitized.matchAll(/(?<![.\w$])import\s*\(\s*(['\"])([^'\"]+)\1\s*\)/g)];
        // A re-export also depends on its source module even without "import".
        // Only literal sources are collected; comments/strings remain excluded.
        const reExports = [...sanitized.matchAll(
          /(?<![.\w$])export\s+(?:type\s+)?(?:\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?|\{[^}]*\}\s*)from\s*(['"])([^'"]+)\1/g
        )];
        // CommonJS requires are dependencies only when the specifier is a
        // literal; do not infer computed/member calls or strings/comments.
        const commonJsRequires = [...sanitized.matchAll(
          /(?<![.\w$])require\s*\(\s*(['"])([^'"]+)\1\s*\)/g
        )];
        const imports = [...staticImports, ...dynamicImports, ...reExports, ...commonJsRequires]
          .filter(m => !quotedOffsets.has(m.index))
          .sort((a, b) => a.index - b.index)
          .map(m => m[2] ?? m[1]);
        // Modifiers and TS declaration keywords are not exported symbol names.
        // Recognize async/generator functions and interface/type/enum declarations.
        const exports = [...sanitized.matchAll(
          /export\s+(?:default\s+)?(?:(?:declare|abstract|async|type|interface|enum|namespace)\s+)*(?:class|function\s*\*?|const|let|var)?\s*([A-Za-z0-9_$]*)/g
        )]
          .filter(m => !quotedOffsets.has(m.index)
            && !/^(?:type\s+)?(?:\*|\{)/.test(sanitized.slice(m.index + 6).trimStart()))
          .map(m => m[1] || 'default');
        importMap.set(full, imports);
        exportMap.set(full, exports);
      }
    }
  }

  await walk(root);
  return { fileMap, importMap, exportMap };
}
