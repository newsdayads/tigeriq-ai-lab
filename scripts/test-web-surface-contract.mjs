import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../command-center-control.html', import.meta.url), 'utf8');
const required = [
  'OWNER COMMAND CENTER',
  'OFF-MAIN',
  'CHẠY 1',
  "fetch('/api/web-control'",
  'JSON.stringify({command:\'1\'})',
  'RUNNING',
  'EXTERNAL_WAIT',
  'EVIDENCE',
  'Main/Production',
  'paid action',
  'reboot',
  'credential/security',
];
for (const marker of required) {
  if (!html.includes(marker)) throw new Error(`WEB_SURFACE_CONTRACT_FAILED: missing ${marker}`);
}
if (/<form/i.test(html)) throw new Error('WEB_SURFACE_CONTRACT_FAILED: unexpected form surface');
console.log('WEB_SURFACE_CONTRACT_PASS');
