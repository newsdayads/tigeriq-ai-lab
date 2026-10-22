#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProject } from './scanner.mjs';
import { buildHtmlReport } from './html-report.mjs';

const USAGE = [
  'TigerIQ Project Code Map (Node >=20)',
  'Usage: node tools/project-code-map/cli.mjs [--root DIR] [--output FILE] [--html FILE] [--query PATH] [--expect-sha SHA]',
  '  --root DIR     Folder to scan (default: current working directory)',
  '  --output FILE  Write UTF-8 JSON; without it, emit JSON to stdout',
  '  --html FILE    Generate an offline interactive HTML explorer',
  '  --query PATH   Emit only a selected repository-relative module and its dependency neighborhood',
  '  --expect-sha SHA  Fail closed if source revision differs (query mode only)',
  '  --help         Show this help',
].join('\n');

function optionsFromArgs(args) {
  let root = process.cwd();
  let output = null;
  let html = null;
  let query = null;
  let expectedSha = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg !== '--root' && arg !== '--output' && arg !== '--html' && arg !== '--query' && arg !== '--expect-sha') throw new Error('Unknown option: ' + arg);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + arg);
    if (arg === '--root') root = value;
    else if (arg === '--output') output = value;
    else if (arg === '--html') html = value;
    else if (arg === '--query') query = value;
    else expectedSha = value;
  }
  if (query && html) throw new Error('Cannot combine --query with --html');
  if (expectedSha && !query) throw new Error('--expect-sha requires --query');
  if (expectedSha && !/^[0-9a-f]{40}$/i.test(expectedSha)) throw new Error('Invalid --expect-sha (requires 40 hex characters)');
  return { root: path.resolve(root), output: output ? path.resolve(output) : null,
    html: html ? path.resolve(html) : null, query, expectedSha };
}

function relativeUnix(root, filename) {
  return path.relative(root, filename).split(path.sep).join('/');
}

export async function buildCodeMap(root) {
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error('Not a directory: ' + root);
  const { fileMap, importMap } = await scanProject(root);
  const nodes = [...fileMap.keys()].map(file => relativeUnix(root, file)).sort();
  const edges = [];
  for (const [file, imports] of importMap) {
    for (const specifier of imports) {
      edges.push({ from: relativeUnix(root, file), to: specifier });
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return {
    schemaVersion: 1,
    sourceRevision: process.env.TIGERIQ_SOURCE_SHA || null,
    rootName: path.basename(root),
    summary: {
      sourceFiles: nodes.length,
      dependencyEdges: edges.length,
      filesWithImports: new Set(edges.map(edge => edge.from)).size,
    },
    nodes,
    edges,
  };
}


const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.mts', '.cts'];

// Resolve only first-party relative specifiers; aliases and computed imports
// remain unknown rather than claiming links that the graph cannot prove.
function resolveInternalImport(from, specifier, nodeSet) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  if (base === '..' || base.startsWith('../') || path.posix.isAbsolute(base)) return null;
  for (const suffix of ['', ...SOURCE_EXTENSIONS, ...SOURCE_EXTENSIONS.map(ext => '/index' + ext)]) {
    if (nodeSet.has(base + suffix)) return base + suffix;
  }
  return null;
}

export function queryCodeMap(report, modulePath, expectedSha = null) {
  if (expectedSha !== null && (!report.sourceRevision || report.sourceRevision !== expectedSha)) {
    throw new Error('CODE_MAP_STALE_REVISION: expected ' + expectedSha +
      ', actual ' + (report.sourceRevision || 'UNKNOWN'));
  }
  if (!modulePath || modulePath.includes('\\') || path.posix.isAbsolute(modulePath) ||
      path.posix.normalize(modulePath) !== modulePath || modulePath === '..' ||
      modulePath.startsWith('../')) {
    throw new Error('CODE_MAP_INVALID_MODULE_PATH');
  }
  const nodes = new Set(report.nodes);
  if (!nodes.has(modulePath)) throw new Error('CODE_MAP_MODULE_NOT_FOUND: ' + modulePath);
  const outgoing = [];
  const incoming = [];
  for (const edge of report.edges) {
    const resolvedTarget = resolveInternalImport(edge.from, edge.to, nodes);
    if (edge.from === modulePath) {
      outgoing.push({ specifier: edge.to, resolvedTarget });
    }
    if (resolvedTarget === modulePath) {
      incoming.push({ from: edge.from, specifier: edge.to });
    }
  }
  return {
    schemaVersion: report.schemaVersion,
    sourceRevision: report.sourceRevision,
    revisionChecked: expectedSha !== null,
    sourceRef: modulePath,
    summary: { outgoing: outgoing.length, incoming: incoming.length },
    outgoing,
    incoming,
  };
}

async function main() {
  let opts;
  try {
    opts = optionsFromArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message + '\n' + USAGE);
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  try {
    const report = await buildCodeMap(opts.root);
    const result = opts.query ? queryCodeMap(report, opts.query, opts.expectedSha) : report;
    const json = JSON.stringify(result, null, 2) + '\n';
    if (opts.html) {
      await fs.mkdir(path.dirname(opts.html), { recursive: true });
      await fs.writeFile(opts.html, buildHtmlReport(report), 'utf8');
      console.error('CODE_MAP_HTML_OK output=' + opts.html);
    }
    if (opts.output) {
      await fs.mkdir(path.dirname(opts.output), { recursive: true });
      await fs.writeFile(opts.output, json, 'utf8');
      console.error((opts.query ? 'CODE_MAP_QUERY_OK module=' + opts.query :
        'CODE_MAP_OK files=' + report.summary.sourceFiles + ' edges=' + report.summary.dependencyEdges) +
        ' output=' + opts.output);
    } else {
      process.stdout.write(json);
    }
  } catch (error) {
    console.error('CODE_MAP_FAILED: ' + (error?.message || String(error)));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
