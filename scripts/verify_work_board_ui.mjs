import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/web-v1/index.html', 'utf8');
const app = readFileSync('public/web-v1/app.js', 'utf8');
const client = readFileSync('public/web-v1/controller-client.js', 'utf8');
const mock = readFileSync('public/web-v1/mock-data.js', 'utf8');
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));

for (const label of ['Web Control V1','Giao mục tiêu','Jobs','Employees','AI Providers','Prompt Architect','Result & Evidence','Blocker & Recovery','Lịch sử','Kết nối']) assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
assert.equal(config.rewrites.find(row=>row.source==='/')?.destination,'/web-v1/index.html');
assert.match(client,/\/api\/web\/v1\/snapshot/);
assert.match(client,/\/api\/workforce\/status/);
assert.doesNotMatch(client,/x-tigeriq-admin-secret.*=/);
assert.doesNotMatch(app,/api\.github\.com|\/api\/web-control-status/);
assert.match(mock,/authoritative:\s*false/);
assert.match(mock,/MOCK-JOB-001/);
console.log('WEB_CONTROL_V1_UI_PASS');
