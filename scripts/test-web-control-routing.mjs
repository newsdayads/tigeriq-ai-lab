import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../api/control.mjs', import.meta.url), 'utf8');

const required = [
  "normalizeWebControlCommand",
  "oneCommandWebControlPlan",
  "normalizedCommand === '1'",
  "mode: 'web-control'",
  "lane: 'web-control'",
];

for (const marker of required) {
  if (!source.includes(marker)) throw new Error(`WEB_CONTROL_ROUTING_FAIL missing=${marker}`);
}

if (source.includes("String(body.instruction || body.message || '').trim()") && !source.includes("normalizedCommand")) {
  throw new Error('WEB_CONTROL_ROUTING_FAIL command path lacks deterministic normalization');
}

console.log('WEB_CONTROL_ROUTING_SOURCE_PASS');
