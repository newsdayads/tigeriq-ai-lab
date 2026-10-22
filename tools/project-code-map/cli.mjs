#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProject } from './scanner.mjs';

const USAGE = [
  'TigerIQ Project Code Map (Node >=20)',
  'Usage: node tools/project-code-map/cli.mjs [--root DIR] [--output FILE]',
  '  --root DIR     Folder to scan (default: current working directory)',
  '  --output FILE  Write UTF-8 JSON; without it, emit JSON to stdout',
  '  --help         Show this help',
].join('\n');

function optionsFromArgs(args) {
  let root = process.cwd();
  let output = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg !== '--root' && arg !== '--output') throw new Error('Unknown option: ' + arg);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + arg);
    if (arg === '--root') root = value;
    else output = value;
  }
  return { root: path.resolve(root), output: output ? path.resolve(output) : null };
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
    const json = JSON.stringify(report, null, 2) + '\n';
    if (opts.output) {
      await fs.mkdir(path.dirname(opts.output), { recursive: true });
      await fs.writeFile(opts.output, json, 'utf8');
      console.error('CODE_MAP_OK files=' + report.summary.sourceFiles +
        ' edges=' + report.summary.dependencyEdges + ' output=' + opts.output);
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
