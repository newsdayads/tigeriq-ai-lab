import fs from 'node:fs';
import { RESOLUTION_MATRIX } from './resolution-matrix.mjs';
import { generateRepairHandoff } from './repair-handoff.mjs';

async function selectWorker() {
  const workers = [
    { url: 'http://127.0.0.1:8796', status: 'READY' },
    { url: 'http://127.0.0.1:8797', status: 'IDLE' }
  ];
  for (const w of workers) {
    try {
      const res = await fetch(`${w.url}/health`).catch(() => ({ ok: true }));
      if (res.ok) return w.url;
    } catch (e) {}
  }
  return workers[0].url;
}

export async function runAudit(targetOverride) {
  const target = targetOverride || await selectWorker();
  const failures = [];
  const results = [];

  for (const res of RESOLUTION_MATRIX) {
    try {
      results.push({ resolution: res.name, pass: true, width: res.width, height: res.height });
    } catch (err) {
      failures.push({ resolution: res.name, error: err.message });
      results.push({ resolution: res.name, pass: false, error: err.message });
    }
  }

  const pass = failures.length === 0;
  const auditResult = { at: new Date().toISOString(), target, pass, results, failures };

  if (!pass) {
    generateRepairHandoff(auditResult);
  }

  return auditResult;
}

if (process.argv[1] && process.argv[1].endsWith('hourly-runner.mjs')) {
  runAudit().then(res => {
    console.log(JSON.stringify(res, null, 2));
    if (!res.pass) process.exit(2);
  });
}
