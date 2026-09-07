import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../api/control.mjs', import.meta.url), 'utf8');

const required = [
  "normalizeWebControlCommand",
  "oneCommandWebControlPlan",
  "const command = normalizeWebControlCommand(message)",
  "if (command === '1')",
  "mode: 'web-control'",
  "lane: 'web-control'",
  "state: 'external-wait'",
  "reason: 'runtime_executor_unavailable'",
  "Không tạo Generic Work Order",
];

for (const marker of required) {
  if (!source.includes(marker)) throw new Error(`WEB_CONTROL_ROUTING_FAIL missing=${marker}`);
}

console.log('WEB_CONTROL_ROUTING_SOURCE_PASS');
